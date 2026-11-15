import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import { isPrivateIp } from '../utils/url-validation';

/**
 * Pure simulation mode (docs/dev/simulacao-pura.md).
 *
 * `THINKER_SIMULATION=true` runs Thinker against simulated providers only:
 * every outbound HTTP call is refused unless its destination is loopback or a
 * private network. The guard is enforced in the outbound layer
 * ({@link assertSimulationDestination}, called by `outboundFetch`,
 * `fetchViaProxy`, `pinnedDirectFetch` and the CIMD transport) and on the
 * global `fetch` ({@link installSimulationFetchGuard}), so a call that skips
 * the outbound helpers is refused too.
 *
 * `THINKER_SIM_CATALOG_URLS` (`models_dev=<url>,openrouter=<url>,opencode=<url>`)
 * replaces the public catalog URLs, so a simulated instance can price models
 * from a local catalog. It is read only with simulation on, and every URL must
 * be loopback or private, or the boot fails.
 *
 * Without `THINKER_SIMULATION` none of this does anything.
 */
export const SIMULATION_ENV = 'THINKER_SIMULATION';
export const SIM_CATALOG_URLS_ENV = 'THINKER_SIM_CATALOG_URLS';
export const SIMULATION_BANNER = 'SIMULATION MODE: providers are simulated, no external traffic';

const logger = new Logger('Simulation');

const ON_VALUES = new Set(['true', '1', 'yes', 'on']);

/** Read at call time, so tests and the boot see the configured value. */
export function isSimulationMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return ON_VALUES.has((env[SIMULATION_ENV] ?? '').trim().toLowerCase());
}

export class SimulationEgressBlockedError extends Error {
  readonly code = 'ESIMULATIONBLOCKED';

  constructor(readonly destination: string) {
    super(
      `Simulation mode (${SIMULATION_ENV}=true): refusing outbound request to ${destination}; ` +
        'only loopback and private network destinations are allowed',
    );
    this.name = 'SimulationEgressBlockedError';
  }
}

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '');
}

function isLocalName(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.$/, '');
  return lower === 'localhost' || lower.endsWith('.localhost');
}

/** True for a loopback/private IP literal or a `localhost` name. No DNS. */
export function isSimulationLocalHost(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (isLocalName(host)) return true;
  return isIP(host) !== 0 && isPrivateIp(host);
}

function destinationOf(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.hostname}:${port}`;
}

function refuse(url: URL): never {
  const error = new SimulationEgressBlockedError(destinationOf(url));
  logger.error(`Outbound request refused: ${error.message}`);
  throw error;
}

/**
 * With simulation on, throws {@link SimulationEgressBlockedError} (and logs)
 * unless `url` is loopback or private. A host name must resolve only to such
 * addresses. Without simulation it returns immediately.
 */
export async function assertSimulationDestination(
  url: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isSimulationMode(env)) return;
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return; // fetch itself rejects an invalid URL
  }
  const host = stripBrackets(parsed.hostname);
  if (isSimulationLocalHost(host)) return;
  if (isIP(host) !== 0) refuse(parsed);
  let addresses: { address: string }[];
  try {
    addresses = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    refuse(parsed);
  }
  if (addresses.length === 0 || !addresses.every(({ address }) => isPrivateIp(address))) {
    refuse(parsed);
  }
}

function fetchInputUrl(input: unknown): string | URL | null {
  if (typeof input === 'string' || input instanceof URL) return input;
  const url = (input as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : null;
}

let installed: typeof fetch | null = null;

/**
 * Wraps the global `fetch` so any call made without the outbound helpers is
 * refused too. Installed at boot only with simulation on; idempotent.
 */
export function installSimulationFetchGuard(): void {
  if (installed) return;
  const original = globalThis.fetch;
  installed = original;
  const guarded = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = fetchInputUrl(input);
    if (url) await assertSimulationDestination(url);
    return original(input, init);
  };
  globalThis.fetch = guarded as typeof fetch;
}

/** Tests only: restore the original global `fetch`. */
export function uninstallSimulationFetchGuardForTests(): void {
  if (!installed) return;
  globalThis.fetch = installed;
  installed = null;
}

export type SimCatalog = 'models_dev' | 'openrouter' | 'opencode';
const SIM_CATALOGS: readonly SimCatalog[] = ['models_dev', 'openrouter', 'opencode'];

export class SimulationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationConfigError';
  }
}

/**
 * Parses `THINKER_SIM_CATALOG_URLS`. Throws {@link SimulationConfigError} for
 * an unknown catalog name, an invalid URL or a destination that is not
 * loopback or a private IP literal.
 */
export function parseSimCatalogUrls(
  value: string | undefined,
): Partial<Record<SimCatalog, string>> {
  const out: Partial<Record<SimCatalog, string>> = {};
  if (!value?.trim()) return out;
  for (const part of value.split(',')) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    const name = (eq > 0 ? item.slice(0, eq) : '').trim() as SimCatalog;
    const raw = eq > 0 ? item.slice(eq + 1).trim() : '';
    if (!SIM_CATALOGS.includes(name)) {
      throw new SimulationConfigError(
        `${SIM_CATALOG_URLS_ENV}: unknown catalog "${name || item}" (expected ${SIM_CATALOGS.join(', ')})`,
      );
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SimulationConfigError(`${SIM_CATALOG_URLS_ENV}: ${name} has an invalid URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SimulationConfigError(`${SIM_CATALOG_URLS_ENV}: ${name} must be http(s)`);
    }
    if (!isSimulationLocalHost(url.hostname)) {
      throw new SimulationConfigError(
        `${SIM_CATALOG_URLS_ENV}: ${name} must point at loopback or a private network address, got ${url.host}`,
      );
    }
    out[name] = url.href;
  }
  return out;
}

/**
 * The URL to fetch for a public catalog: the simulated one when simulation is
 * on and `THINKER_SIM_CATALOG_URLS` names it, else `publicUrl`. An invalid
 * variable falls back to `publicUrl` here (the boot already refused it).
 */
export function catalogUrl(
  catalog: SimCatalog,
  publicUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isSimulationMode(env)) return publicUrl;
  try {
    return parseSimCatalogUrls(env[SIM_CATALOG_URLS_ENV])[catalog] ?? publicUrl;
  } catch {
    return publicUrl;
  }
}

/**
 * Boot check and banner. With simulation on: validates the catalog URLs
 * (throws on a bad value), installs the fetch guard and logs the banner.
 * Without it: warns when simulation-only variables are set and ignored.
 */
export function applySimulationMode(
  env: NodeJS.ProcessEnv = process.env,
  log: Pick<Logger, 'warn' | 'log'> = logger,
): boolean {
  if (!isSimulationMode(env)) {
    if (env[SIM_CATALOG_URLS_ENV]?.trim()) {
      log.warn(`${SIM_CATALOG_URLS_ENV} is set but ignored: ${SIMULATION_ENV} is not on.`);
    }
    return false;
  }
  const catalogs = parseSimCatalogUrls(env[SIM_CATALOG_URLS_ENV]);
  installSimulationFetchGuard();
  const bar = '='.repeat(SIMULATION_BANNER.length);
  log.warn(bar);
  log.warn(SIMULATION_BANNER);
  log.warn(bar);
  const names = Object.keys(catalogs);
  log.log(
    names.length > 0
      ? `Simulated catalogs: ${names.map((n) => `${n}=${catalogs[n as SimCatalog]}`).join(', ')}`
      : `No ${SIM_CATALOG_URLS_ENV}: the public catalogs are refused, bundled data is used.`,
  );
  return true;
}
