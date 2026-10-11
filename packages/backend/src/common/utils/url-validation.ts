import { lookup } from 'dns/promises';
import { isIP } from 'net';

const PRIVATE_RANGES: { addr: bigint; mask: bigint }[] = [
  cidr('127.0.0.0', 8), // Loopback
  cidr('10.0.0.0', 8), // Class A private
  cidr('172.16.0.0', 12), // Class B private
  cidr('192.168.0.0', 16), // Class C private
  cidr('169.254.0.0', 16), // Link-local
  cidr('100.64.0.0', 10), // Carrier-grade NAT (RFC 6598) — routes to cloud fabric (EKS/GKE pods, Tailscale)
  cidr('0.0.0.0', 8), // Current network
];

// ULA (fc00::/7) covers fc00::–fdff::, link-local is fe80::/10.
// We match by two-character hex prefix to avoid false negatives on
// addresses like fdc4:… that don't literally start with "fd00::".
const PRIVATE_V6_PREFIXES = ['::1', 'fc', 'fd', 'fe80::'];

function cidr(base: string, prefix: number): { addr: bigint; mask: bigint } {
  const addr = ipv4ToBigInt(base);
  const mask = (BigInt('0xFFFFFFFF') << BigInt(32 - prefix)) & BigInt('0xFFFFFFFF');
  return { addr: addr & mask, mask };
}

function ipv4ToBigInt(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  return (
    BigInt((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) & BigInt('0xFFFFFFFF')
  );
}

export function isIpLiteral(host: string): boolean {
  return isIP(host) !== 0;
}

/** The 8 hextets of a valid IPv6 literal, or null for anything else. */
function ipv6Hextets(host: string): number[] | null {
  if (isIP(host) !== 6) return null;
  // host is a valid IPv6 literal, so `::` appears at most once and every
  // group is valid hex (or a single dotted-quad tail) — no defensive parsing.
  const parseGroups = (segment: string): number[] =>
    segment === ''
      ? []
      : segment.split(':').flatMap((part) => {
          const dotted = part.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
          if (dotted) {
            const o = dotted.slice(1).map(Number);
            return [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
          }
          return [parseInt(part, 16)];
        });

  const [head, tail] = host.toLowerCase().split('::');
  const left = parseGroups(head);
  const right = tail === undefined ? [] : parseGroups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

function ipv4FromHextets(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

// Collapse an IPv6 address that embeds an IPv4 address to its dotted-quad
// IPv4 form so the IPv4 range checks can see it. Node's URL parser normalizes
// `[::ffff:169.254.169.254]` to the *hex* form `::ffff:a9fe:a9fe`, which a
// dotted-only regex misses — that gap let a mapped literal smuggle a private
// or cloud-metadata target past the SSRF guard. Covered embeddings:
// - IPv4-mapped `::ffff:0:0/96` and IPv4-compatible `::/96`;
// - NAT64 well-known prefix `64:ff9b::/96` (RFC 6052);
// - 6to4 `2002::/16` (RFC 3056), IPv4 in hextets 1-2;
// - Teredo `2001::/32` (RFC 4380), client IPv4 obfuscated in hextets 6-7.
// Other hosts pass through unchanged.
function unwrapMappedIpv4(host: string): string {
  const h = ipv6Hextets(host);
  if (!h) return host;
  const zeroPrefix = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
  if (zeroPrefix && (h[5] === 0xffff || h[5] === 0)) return ipv4FromHextets(h[6], h[7]);
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return ipv4FromHextets(h[6], h[7]);
  }
  if (h[0] === 0x2002) return ipv4FromHextets(h[1], h[2]);
  if (h[0] === 0x2001 && h[1] === 0) return ipv4FromHextets(~h[6] & 0xffff, ~h[7] & 0xffff);
  return host;
}

export function isPrivateIp(ip: string): boolean {
  // Collapse IPv4-mapped IPv6 (any textual form) to dotted IPv4 first.
  const normalizedIp = unwrapMappedIpv4(ip);

  // Check IPv6 private ranges
  if (normalizedIp.includes(':')) {
    const lower = normalizedIp.toLowerCase();
    return PRIVATE_V6_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }

  // Check IPv4 private ranges
  const parsed = normalizedIp.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!parsed) return false;

  const addr = ipv4ToBigInt(normalizedIp);
  return PRIVATE_RANGES.some((range) => (addr & range.mask) === range.addr);
}

// Only the specific IMDS addresses, not the whole link-local /16. Rootless
// Podman maps `host.containers.internal` to a 169.254.x.y address (commonly
// 169.254.1.2 with pasta/slirp4netns), and blocking the entire range would
// stop users from reaching their host gateway. The remaining link-local space
// is still rejected by the private-IP guard (PRIVATE_RANGES above) when
// allowPrivate is off; with allowPrivate on we still block the IMDS endpoints,
// in case the operator deployed inside EC2/GCE/Azure.
const CLOUD_METADATA_RANGES: { addr: bigint; mask: bigint }[] = [
  cidr('169.254.169.254', 32), // AWS / GCP / Azure / OpenStack IMDS
  cidr('169.254.169.253', 32), // Alibaba Cloud / OCI IMDS
  cidr('100.100.100.200', 32), // Alibaba Cloud (alternative)
  cidr('169.254.170.2', 32), // AWS ECS / Fargate task metadata and credentials
  cidr('169.254.170.23', 32), // AWS EKS Pod Identity Agent
];

// IPv6 IMDS endpoints. ULA (`fd00::/8`) and link-local (`fe80::/10`) are
// regular private space — not metadata — so they are NOT in this list.
// `fd00:ec2::254` is the AWS IPv6 IMDS endpoint and `fd00:ec2::23` the IPv6
// EKS Pod Identity Agent. Stored as hextets so any textual form matches.
const CLOUD_METADATA_V6 = ['fd00:ec2::254', 'fd00:ec2::23'].map((ip) => ipv6Hextets(ip)!);

// Metadata hostnames. Inside the cloud they resolve to the IMDS address and the
// resolved-address check catches them; refusing the well-known names up front
// also covers a resolver that answers differently at connect time.
const CLOUD_METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

export function isCloudMetadataHostname(hostname: string): boolean {
  return CLOUD_METADATA_HOSTNAMES.has(hostname.toLowerCase().replace(/\.$/, ''));
}

export function isCloudMetadataIp(ip: string): boolean {
  const normalizedIp = unwrapMappedIpv4(ip);

  if (normalizedIp.includes(':')) {
    // Exact address match, not a prefix: `fd00:ec2::254:1` is a legitimate ULA
    // address, not the AWS IMDS endpoint.
    const hextets = ipv6Hextets(normalizedIp);
    return (
      hextets !== null &&
      CLOUD_METADATA_V6.some((metadata) => metadata.every((value, i) => value === hextets[i]))
    );
  }

  const parsed = normalizedIp.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!parsed) return false;

  const addr = ipv4ToBigInt(normalizedIp);
  return CLOUD_METADATA_RANGES.some((range) => (addr & range.mask) === range.addr);
}

export async function validatePublicUrl(
  url: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<void> {
  // Skip SSRF validation in test mode (set SKIP_SSRF_VALIDATION=false to force validation)
  if (process.env['NODE_ENV'] === 'test' && process.env['SKIP_SSRF_VALIDATION'] !== 'false') return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  const allowPrivate = opts.allowPrivate === true;

  // Only http(s) schemes are acceptable. Everything else (ftp, file, gopher,
  // etc.) is always rejected.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https URLs are allowed');
  }
  // HTTPS-only when we can't allow private destinations. Thinker forwards
  // API keys in Authorization headers and plaintext prompts/completions to
  // this URL; any non-TLS hop would expose them to passive wire-sniffing
  // (AC-2 in the Mine paper, arXiv:2604.08407). With allowPrivate we allow
  // http:// for private destinations only — see the final check below.
  if (parsed.protocol === 'http:' && !allowPrivate) {
    throw new Error('Only https URLs are allowed for this destination');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // Cloud-metadata endpoints are always blocked, whatever allowPrivate says.
  if (isCloudMetadataIp(hostname) || isCloudMetadataHostname(hostname)) {
    throw new Error('URLs pointing to cloud metadata endpoints are not allowed');
  }

  // Private IP literal in the URL itself
  if (isPrivateIp(hostname)) {
    if (!allowPrivate) {
      throw new Error('URLs pointing to private or internal networks are not allowed');
    }
    // allowPrivate + private literal: accept. No DNS resolution needed.
    return;
  }

  // Public IP literal: skip DNS, check http plaintext gate below.
  let addresses: { address: string }[];
  if (isIpLiteral(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      const result = await lookup(hostname, { all: true });
      addresses = Array.isArray(result) ? result : [result];
    } catch {
      // A name that does not resolve here does not resolve for the fetch
      // either (same resolver: /etc/hosts, mDNS and LAN DNS included), so a
      // DNS failure is never a pass, even with allowPrivate. Accepting it let a
      // hostile resolver fail validation and answer IMDS at connect time.
      throw new Error(`Failed to resolve hostname: ${hostname}`);
    }
  }

  let anyPublic = false;
  for (const { address } of addresses) {
    if (isCloudMetadataIp(address)) {
      throw new Error('URLs pointing to cloud metadata endpoints are not allowed');
    }
    if (isPrivateIp(address)) {
      if (!allowPrivate) {
        throw new Error('URLs pointing to private or internal networks are not allowed');
      }
    } else {
      anyPublic = true;
    }
  }

  // Defense in depth: refuse to send plaintext credentials to a public IP
  // via http even when allowPrivate is on (mixed-A-record attack).
  if (parsed.protocol === 'http:' && anyPublic) {
    throw new Error('http:// is only allowed for private hosts');
  }
}
