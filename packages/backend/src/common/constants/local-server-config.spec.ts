const mockAlias = jest.fn(() => 'host.docker.internal');
jest.mock('../utils/container-host', () => ({
  getContainerHostAlias: () => mockAlias(),
}));

import {
  LOCAL_SERVER_DEFAULT_PROBE_TIMEOUT_MS,
  LOCAL_SERVER_DEFAULT_REQUEST_TIMEOUT_MS,
  defaultLocalServerConfig,
  invalidLocalServerConfigReason,
  localServerBaseUrl,
  localServerConfigFromBaseUrl,
  localServerRootUrl,
  normalizePathPrefix,
  type LocalServerConfig,
} from './local-servers';

const ENV = ['OLLAMA_HOST', 'THINKER_LMSTUDIO_BASE_URL', 'THINKER_LLAMACPP_BASE_URL'];

const base: LocalServerConfig = {
  scheme: 'http',
  host: '192.168.1.20',
  port: 11434,
  path_prefix: '',
  request_timeout_ms: LOCAL_SERVER_DEFAULT_REQUEST_TIMEOUT_MS,
  probe_timeout_ms: LOCAL_SERVER_DEFAULT_PROBE_TIMEOUT_MS,
};

describe('local server config', () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  beforeEach(() => {
    for (const k of ENV) delete process.env[k];
    mockAlias.mockReturnValue('host.docker.internal');
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('defaults each type to the container host alias and its documented port', () => {
    expect(defaultLocalServerConfig('ollama')).toMatchObject({
      scheme: 'http',
      host: 'host.docker.internal',
      port: 11434,
      path_prefix: '',
    });
    expect(defaultLocalServerConfig('lmstudio').port).toBe(1234);
    expect(defaultLocalServerConfig('llamacpp').port).toBe(9931);
  });

  it('pre-fills from the env vars, including OLLAMA_HOST host:port and bind-all forms', () => {
    process.env['OLLAMA_HOST'] = '192.168.1.21:11500';
    expect(defaultLocalServerConfig('ollama')).toMatchObject({ host: '192.168.1.21', port: 11500 });
    process.env['OLLAMA_HOST'] = '0.0.0.0';
    expect(defaultLocalServerConfig('ollama')).toMatchObject({
      host: 'host.docker.internal',
      port: 11434,
    });
    process.env['THINKER_LLAMACPP_BASE_URL'] = 'https://mac-studio.lan:8443/llama/v1';
    expect(defaultLocalServerConfig('llamacpp')).toMatchObject({
      scheme: 'https',
      host: 'mac-studio.lan',
      port: 8443,
      path_prefix: '/llama',
    });
  });

  it('ignores an unusable env value', () => {
    process.env['THINKER_LMSTUDIO_BASE_URL'] = 'http://user:pw@box:1234';
    expect(defaultLocalServerConfig('lmstudio')).toMatchObject({
      host: 'host.docker.internal',
      port: 1234,
    });
  });

  it('builds the root and the OpenAI-compatible base URL', () => {
    const cfg = { ...base, path_prefix: '/api/llm/' };
    expect(localServerRootUrl(cfg)).toBe('http://192.168.1.20:11434/api/llm');
    expect(localServerBaseUrl(cfg)).toBe('http://192.168.1.20:11434/api/llm/v1');
    expect(localServerBaseUrl({ ...base, host: '[::1]' })).toBe('http://[::1]:11434/v1');
  });

  it('normalises path prefixes', () => {
    expect(normalizePathPrefix('')).toBe('');
    expect(normalizePathPrefix('/')).toBe('');
    expect(normalizePathPrefix('llama//')).toBe('/llama');
  });

  it.each([
    [{ host: 'box:1234' }, 'host'],
    [{ host: 'user@box' }, 'host'],
    [{ host: 'box/path' }, 'host'],
    [{ port: 0 }, 'port'],
    [{ port: 70000 }, 'port'],
    [{ path_prefix: '/a?b=1' }, 'path prefix'],
    [{ path_prefix: '/a#x' }, 'path prefix'],
    [{ path_prefix: '/../admin' }, 'path prefix'],
    [{ request_timeout_ms: 10 }, 'request_timeout_ms'],
    [{ scheme: 'ftp' as never }, 'scheme'],
  ])('rejects %o', (patch, field) => {
    expect(invalidLocalServerConfigReason({ ...base, ...patch })).toContain(field);
  });

  it('accepts a LAN server', () => {
    expect(invalidLocalServerConfigReason(base)).toBeNull();
  });

  it('splits a stored base URL back into a config', () => {
    expect(localServerConfigFromBaseUrl('http://host.docker.internal:1234/v1', 'lmstudio')).toEqual(
      {
        scheme: 'http',
        host: 'host.docker.internal',
        port: 1234,
        path_prefix: '',
        request_timeout_ms: LOCAL_SERVER_DEFAULT_REQUEST_TIMEOUT_MS,
        probe_timeout_ms: LOCAL_SERVER_DEFAULT_PROBE_TIMEOUT_MS,
      },
    );
    expect(localServerConfigFromBaseUrl('http://gpu/llama/v1', 'llamacpp')).toMatchObject({
      port: 9931,
      path_prefix: '/llama',
    });
    expect(localServerConfigFromBaseUrl('not a url', 'ollama')).toBeNull();
  });
});
