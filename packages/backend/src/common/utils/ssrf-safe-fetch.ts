import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { isCloudMetadataHostname, isCloudMetadataIp } from './url-validation';

/**
 * Connection-time SSRF guard for requests to operator- or tenant-supplied URLs
 * (custom providers, user-chosen provider base URLs).
 *
 * `validatePublicUrl()` checks a URL before it is used, but `fetch` resolves the
 * hostname again on its own. A hostile resolver can answer a public address (or
 * fail) during validation and a cloud metadata address at connect time (DNS
 * rebinding). This module closes that gap: the dispatcher's `lookup` resolves
 * the name once, refuses the connection when ANY returned address is a cloud
 * metadata endpoint, and hands the socket only the addresses it validated, so
 * the address checked is the address connected to. A DNS failure fails the
 * request. Private and LAN addresses stay allowed: local models are a feature.
 */

export class SsrfBlockedError extends Error {
  readonly code = 'ESSRFBLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '');
}

/** Throws when the host is a metadata name or a metadata IP literal. */
export function assertConnectableHost(hostname: string): void {
  const host = stripBrackets(hostname);
  if (isCloudMetadataHostname(host)) {
    throw new SsrfBlockedError(`Refusing to connect to cloud metadata host ${host}`);
  }
  if (isIP(host) !== 0 && isCloudMetadataIp(host)) {
    throw new SsrfBlockedError(`Refusing to connect to cloud metadata address ${host}`);
  }
}

/**
 * Resolves a hostname and returns its addresses only when none of them is a
 * cloud metadata endpoint. One bad answer in a multi-address response blocks
 * the whole connection, so the socket cannot fall back onto it.
 */
export async function resolveConnectableAddresses(hostname: string): Promise<LookupAddress[]> {
  const host = stripBrackets(hostname);
  assertConnectableHost(host);
  const family = isIP(host);
  if (family !== 0) return [{ address: host, family }];

  const addresses = await dnsLookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  }
  for (const { address } of addresses) {
    if (isCloudMetadataIp(address)) {
      throw new SsrfBlockedError(
        `Refusing to connect: ${host} resolved to a cloud metadata address`,
      );
    }
  }
  return addresses;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function requestedFamily(options: unknown): 4 | 6 | 0 {
  const family = (options as { family?: unknown } | undefined)?.family;
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

/** `net.connect`-compatible lookup that only ever yields validated addresses. */
export const ssrfSafeLookup: LookupFunction = (hostname, options, callback) => {
  const done = callback as unknown as LookupCallback;
  resolveConnectableAddresses(hostname).then(
    (addresses) => {
      const family = requestedFamily(options);
      const matching = family ? addresses.filter((entry) => entry.family === family) : addresses;
      if (matching.length === 0) {
        const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
          code: 'ENOTFOUND',
        });
        done(err, '', 0);
        return;
      }
      if ((options as { all?: boolean } | undefined)?.all) {
        done(null, matching);
        return;
      }
      done(null, matching[0]!.address, matching[0]!.family);
    },
    (error: unknown) => done(error instanceof Error ? error : new Error(String(error)), '', 0),
  );
};

let dispatcher: Agent | undefined;

/** Shared keep-alive pool whose every connection goes through `ssrfSafeLookup`. */
export function getSsrfSafeDispatcher(): Agent {
  dispatcher ??= new Agent({ connect: { lookup: ssrfSafeLookup } });
  return dispatcher;
}

/**
 * `fetch` for operator- or tenant-supplied URLs. Uses undici's own `fetch`
 * with the pinned dispatcher: Node's built-in `fetch` bundles a different
 * undici major whose dispatcher interface is not stable across Node versions.
 * Metadata literals and names are refused before any socket is opened.
 */
export async function ssrfSafeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  assertConnectableHost(new URL(url).hostname);
  const response = await undiciFetch(url, {
    ...(init as unknown as UndiciRequestInit),
    dispatcher: getSsrfSafeDispatcher(),
  });
  // undici's Response is not the global `Response` class (`instanceof Response`
  // is false), but it implements the same interface: status, headers, body
  // stream, json()/text(). Callers only use that interface, never instanceof.
  return response as unknown as Response;
}
