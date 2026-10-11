const mockGetContainerHostAlias = jest.fn(() => 'localhost');
jest.mock('../utils/container-host', () => ({
  getContainerHostAlias: () => mockGetContainerHostAlias(),
}));

import { Logger } from '@nestjs/common';
import {
  LOCAL_SERVER_BASE_URL_ENV,
  buildLocalServerHeaders,
  checkLocalServerBaseUrls,
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

  describe('invalid overrides', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => warn.mockRestore());

    it.each([
      ['a host:port without a scheme', '192.168.1.20:1234', 'has no http:// or https:// scheme'],
      ['a hostname:port without a scheme', 'gpu-box:1234', 'has no http:// or https:// scheme'],
      ['a bare hostname', 'gpu-box', 'has no http:// or https:// scheme'],
      ['an unparsable URL', 'http://[gpu-box:1234', 'is not an absolute URL'],
      ['another scheme', 'ftp://gpu-box:1234', 'must use http:// or https://'],
      ['embedded credentials', 'http://user:secret@gpu-box:1234', 'must not embed credentials'],
      ['a query string', 'http://gpu-box:1234/v1?x=1', 'must not carry a query string'],
    ])('ignores %s and uses the default', (_label, value, reason) => {
      process.env['THINKER_LMSTUDIO_BASE_URL'] = value;
      expect(getLocalServerBaseUrl('lmstudio')).toBe('http://localhost:1234');
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('THINKER_LMSTUDIO_BASE_URL');
      expect(message).toContain(reason);
      expect(message).toContain('using http://localhost:1234');
    });

    it('never logs the raw value, which may hold credentials', () => {
      process.env['THINKER_LLAMACPP_BASE_URL'] = 'http://user:hunter2@gpu-box:8080';
      getLocalServerBaseUrl('llamacpp');
      const message = String(warn.mock.calls[0][0]);
      expect(message).not.toContain('hunter2');
      expect(message).not.toContain('gpu-box');
    });

    it('warns once per bad value, not on every request', () => {
      process.env['THINKER_LLAMACPP_BASE_URL'] = 'llama-box:8080';
      getLocalServerBaseUrl('llamacpp');
      getLocalServerBaseUrl('llamacpp');
      expect(warn).toHaveBeenCalledTimes(1);

      process.env['THINKER_LLAMACPP_BASE_URL'] = 'llama-box:9090';
      expect(getLocalServerBaseUrl('llamacpp')).toBe('http://localhost:8080');
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('accepts https and a valid value after a bad one', () => {
      process.env['THINKER_LMSTUDIO_BASE_URL'] = 'https://lm.example.lan/v1';
      expect(getLocalServerBaseUrl('lmstudio')).toBe('https://lm.example.lan');
      expect(warn).not.toHaveBeenCalled();
    });

    it('checks every override at boot', () => {
      process.env['THINKER_LMSTUDIO_BASE_URL'] = 'boot-lm:1234';
      process.env['THINKER_LLAMACPP_BASE_URL'] = 'boot-llama:8080';
      checkLocalServerBaseUrls();
      const messages = warn.mock.calls.map(([m]) => String(m));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('THINKER_LMSTUDIO_BASE_URL');
      expect(messages[1]).toContain('THINKER_LLAMACPP_BASE_URL');
    });

    it('stays quiet at boot when nothing is overridden', () => {
      checkLocalServerBaseUrls();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('sends a bearer token only when the connection stores one', () => {
    expect(buildLocalServerHeaders('')).toEqual({ 'Content-Type': 'application/json' });
    expect(buildLocalServerHeaders('server-token')).toEqual({
      Authorization: 'Bearer server-token',
      'Content-Type': 'application/json',
    });
  });
});
