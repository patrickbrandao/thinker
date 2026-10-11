const mockGetContainerHostAlias = jest.fn(() => 'localhost');
jest.mock('../utils/detect-self-hosted', () => ({
  getContainerHostAlias: () => mockGetContainerHostAlias(),
}));

import {
  LOCAL_SERVER_BASE_URL_ENV,
  buildLocalServerHeaders,
  getLocalServerBaseUrl,
} from './local-servers';

describe('local servers', () => {
  const saved = {
    lmstudio: process.env['THINKER_LMSTUDIO_BASE_URL'],
    llamacpp: process.env['THINKER_LLAMACPP_BASE_URL'],
  };

  beforeEach(() => {
    delete process.env['THINKER_LMSTUDIO_BASE_URL'];
    delete process.env['THINKER_LLAMACPP_BASE_URL'];
    mockGetContainerHostAlias.mockReturnValue('localhost');
  });

  afterAll(() => {
    for (const [id, value] of Object.entries(saved)) {
      const key = LOCAL_SERVER_BASE_URL_ENV[id as keyof typeof saved];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('names one THINKER_* env var per server', () => {
    expect(LOCAL_SERVER_BASE_URL_ENV).toEqual({
      lmstudio: 'THINKER_LMSTUDIO_BASE_URL',
      llamacpp: 'THINKER_LLAMACPP_BASE_URL',
    });
  });

  it('defaults to the documented ports on the container host alias', () => {
    mockGetContainerHostAlias.mockReturnValue('host.docker.internal');
    expect(getLocalServerBaseUrl('lmstudio')).toBe('http://host.docker.internal:1234');
    expect(getLocalServerBaseUrl('llamacpp')).toBe('http://host.docker.internal:8080');
  });

  it('uses localhost outside a container', () => {
    expect(getLocalServerBaseUrl('lmstudio')).toBe('http://localhost:1234');
    expect(getLocalServerBaseUrl('llamacpp')).toBe('http://localhost:8080');
  });

  it('reads the override on every call and strips a trailing /v1', () => {
    process.env['THINKER_LMSTUDIO_BASE_URL'] = 'http://192.168.1.20:1234/v1/';
    expect(getLocalServerBaseUrl('lmstudio')).toBe('http://192.168.1.20:1234');

    process.env['THINKER_LMSTUDIO_BASE_URL'] = 'http://gpu-box:4321';
    expect(getLocalServerBaseUrl('lmstudio')).toBe('http://gpu-box:4321');

    process.env['THINKER_LLAMACPP_BASE_URL'] = '  http://127.0.0.1:9090/v1  ';
    expect(getLocalServerBaseUrl('llamacpp')).toBe('http://127.0.0.1:9090');
  });

  it('keeps a path prefix in front of /v1', () => {
    process.env['THINKER_LLAMACPP_BASE_URL'] = 'http://proxy.lan/llama/v1///';
    expect(getLocalServerBaseUrl('llamacpp')).toBe('http://proxy.lan/llama');
  });

  it('falls back to the default when the override is blank', () => {
    process.env['THINKER_LMSTUDIO_BASE_URL'] = '   ';
    expect(getLocalServerBaseUrl('lmstudio')).toBe('http://localhost:1234');
  });

  it('sends a bearer token only when the connection stores one', () => {
    expect(buildLocalServerHeaders('')).toEqual({ 'Content-Type': 'application/json' });
    expect(buildLocalServerHeaders('server-token')).toEqual({
      Authorization: 'Bearer server-token',
      'Content-Type': 'application/json',
    });
  });
});
