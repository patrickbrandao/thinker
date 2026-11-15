import {
  SimulationConfigError,
  SimulationEgressBlockedError,
  applySimulationMode,
  assertSimulationDestination,
  catalogUrl,
  installSimulationFetchGuard,
  isSimulationMode,
  parseSimCatalogUrls,
  uninstallSimulationFetchGuardForTests,
} from './simulation';
import { outboundFetch } from './outbound-proxy';
import { pinnedDirectFetch, ssrfSafeFetch } from '../utils/ssrf-safe-fetch';

const SIM = { THINKER_SIMULATION: 'true' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

describe('simulation mode', () => {
  const previous = process.env['THINKER_SIMULATION'];
  afterEach(() => {
    uninstallSimulationFetchGuardForTests();
    if (previous === undefined) delete process.env['THINKER_SIMULATION'];
    else process.env['THINKER_SIMULATION'] = previous;
    jest.restoreAllMocks();
  });

  it('is on only for true-like values', () => {
    expect(isSimulationMode(OFF)).toBe(false);
    expect(isSimulationMode({ THINKER_SIMULATION: 'false' })).toBe(false);
    expect(isSimulationMode({ THINKER_SIMULATION: 'TRUE' })).toBe(true);
    expect(isSimulationMode({ THINKER_SIMULATION: '1' })).toBe(true);
  });

  describe('assertSimulationDestination', () => {
    it.each([
      'http://127.0.0.1:18220/v1/chat/completions',
      'http://localhost:18230/models-dev.json',
      'http://[::1]:8080/',
      'http://10.0.0.5/',
      'http://192.168.1.10:11434/api',
      'http://172.20.0.2/',
    ])('allows %s', async (url) => {
      await expect(assertSimulationDestination(url, SIM)).resolves.toBeUndefined();
    });

    it.each(['https://api.openai.com/v1/models', 'http://8.8.8.8/', 'https://[2606:4700::1111]/'])(
      'refuses %s with a clear error',
      async (url) => {
        await expect(assertSimulationDestination(url, SIM)).rejects.toBeInstanceOf(
          SimulationEgressBlockedError,
        );
        await expect(assertSimulationDestination(url, SIM)).rejects.toThrow(
          /THINKER_SIMULATION=true.*refusing outbound request/,
        );
      },
    );

    it('refuses a name that does not resolve to a private address', async () => {
      await expect(
        assertSimulationDestination('https://does-not-exist.invalid/', SIM),
      ).rejects.toBeInstanceOf(SimulationEgressBlockedError);
    });

    it('is inert without THINKER_SIMULATION', async () => {
      await expect(
        assertSimulationDestination('https://api.openai.com/v1/models', OFF),
      ).resolves.toBeUndefined();
    });
  });

  describe('outbound layer', () => {
    it('outboundFetch, ssrfSafeFetch and pinnedDirectFetch refuse a public host in simulation', async () => {
      process.env['THINKER_SIMULATION'] = 'true';
      const spy = jest.spyOn(globalThis, 'fetch');
      await expect(outboundFetch('https://models.dev/api.json')).rejects.toBeInstanceOf(
        SimulationEgressBlockedError,
      );
      await expect(ssrfSafeFetch('https://8.8.8.8/')).rejects.toBeInstanceOf(
        SimulationEgressBlockedError,
      );
      await expect(pinnedDirectFetch('https://1.1.1.1/')).rejects.toBeInstanceOf(
        SimulationEgressBlockedError,
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('the global fetch guard refuses a direct fetch of a public host', async () => {
      process.env['THINKER_SIMULATION'] = 'true';
      const inner = jest.fn(async () => new Response('ok'));
      globalThis.fetch = inner as unknown as typeof fetch;
      installSimulationFetchGuard();
      await expect(fetch('https://api.openai.com/v1/models')).rejects.toBeInstanceOf(
        SimulationEgressBlockedError,
      );
      expect(inner).not.toHaveBeenCalled();
      await fetch('http://127.0.0.1:1/x');
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('outboundFetch is unchanged without simulation', async () => {
      delete process.env['THINKER_SIMULATION'];
      const spy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const res = await outboundFetch('https://models.dev/api.json');
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith('https://models.dev/api.json', {});
    });
  });

  describe('THINKER_SIM_CATALOG_URLS', () => {
    const urls =
      'models_dev=http://127.0.0.1:18230/models-dev.json,openrouter=http://127.0.0.1:18230/openrouter.json,opencode=http://localhost:18230/opencode.json';

    it('parses the three catalogs', () => {
      expect(parseSimCatalogUrls(urls)).toEqual({
        models_dev: 'http://127.0.0.1:18230/models-dev.json',
        openrouter: 'http://127.0.0.1:18230/openrouter.json',
        opencode: 'http://localhost:18230/opencode.json',
      });
    });

    it.each([
      ['models_dev=https://models.dev/api.json', /loopback or a private/],
      ['nope=http://127.0.0.1/', /unknown catalog/],
      ['openrouter=not a url', /invalid URL/],
      ['opencode=ftp://127.0.0.1/x', /http\(s\)/],
    ])('refuses %s', (value, message) => {
      expect(() => parseSimCatalogUrls(value)).toThrow(SimulationConfigError);
      expect(() => parseSimCatalogUrls(value)).toThrow(message);
    });

    it('replaces the public URL only with simulation on', () => {
      const env = { THINKER_SIMULATION: 'true', THINKER_SIM_CATALOG_URLS: urls };
      expect(catalogUrl('models_dev', 'https://models.dev/api.json', env)).toBe(
        'http://127.0.0.1:18230/models-dev.json',
      );
      expect(
        catalogUrl('models_dev', 'https://models.dev/api.json', { THINKER_SIM_CATALOG_URLS: urls }),
      ).toBe('https://models.dev/api.json');
      expect(
        catalogUrl('openrouter', 'https://openrouter.ai/api/v1/models', {
          THINKER_SIMULATION: 'true',
          THINKER_SIM_CATALOG_URLS: 'models_dev=http://127.0.0.1/x',
        }),
      ).toBe('https://openrouter.ai/api/v1/models');
    });
  });

  describe('applySimulationMode', () => {
    const log = () => ({ warn: jest.fn(), log: jest.fn() });

    it('logs the banner and installs the guard with simulation on', () => {
      const l = log();
      const original = globalThis.fetch;
      expect(applySimulationMode({ THINKER_SIMULATION: 'true' }, l)).toBe(true);
      expect(l.warn).toHaveBeenCalledWith(
        'SIMULATION MODE: providers are simulated, no external traffic',
      );
      expect(globalThis.fetch).not.toBe(original);
    });

    it('fails the boot on a public catalog URL', () => {
      expect(() =>
        applySimulationMode(
          {
            THINKER_SIMULATION: 'true',
            THINKER_SIM_CATALOG_URLS: 'openrouter=https://openrouter.ai/x',
          },
          log(),
        ),
      ).toThrow(SimulationConfigError);
    });

    it('does nothing without simulation, and warns about an ignored catalog variable', () => {
      const l = log();
      const original = globalThis.fetch;
      expect(
        applySimulationMode({ THINKER_SIM_CATALOG_URLS: 'models_dev=https://evil.example/' }, l),
      ).toBe(false);
      expect(globalThis.fetch).toBe(original);
      expect(l.warn).toHaveBeenCalledWith(expect.stringMatching(/ignored/));
    });
  });
});
