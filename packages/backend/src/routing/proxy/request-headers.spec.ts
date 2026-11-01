import {
  receivedHeaders,
  recordedRequestHeaders,
  requestLineHeaders,
  sanitizeRequestHeaders,
} from './request-headers';

describe('sanitizeRequestHeaders', () => {
  it('returns null when no headers are provided', () => {
    expect(sanitizeRequestHeaders({})).toBeNull();
  });

  it('keeps ordinary headers and lowercases keys', () => {
    expect(
      sanitizeRequestHeaders({
        'Content-Type': 'application/json',
        'User-Agent': 'curl/8.14.1',
        'X-Custom-Foo': 'bar',
      }),
    ).toEqual({
      'content-type': 'application/json',
      'user-agent': 'curl/8.14.1',
      'x-custom-foo': 'bar',
    });
  });

  it('keeps sensitive headers but redacts their values, preserving the auth scheme', () => {
    const result = sanitizeRequestHeaders({
      Authorization: 'Bearer thk_secret',
      Cookie: 'session=abc',
      'Set-Cookie': 'x=y',
      'Proxy-Authorization': 'Basic xxx',
      'X-API-Key': 'abc',
      'x-safe': 'keep',
    });
    expect(result).toEqual({
      authorization: 'Bearer [REDACTED]',
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'proxy-authorization': 'Basic [REDACTED]',
      'x-api-key': '[REDACTED]',
      'x-safe': 'keep',
    });
    expect(JSON.stringify(result)).not.toContain('thk_secret');
  });

  it('keeps proxy, edge and transport headers', () => {
    const result = sanitizeRequestHeaders({
      'X-Forwarded-For': '193.33.57.199, 10.0.0.1',
      'X-Forwarded-Host': 'app.thinker.example.com',
      'X-Forwarded-Proto': 'https',
      'X-Real-Ip': '193.33.57.199',
      Forwarded: 'for="193.33.57.199";proto=https',
      Via: '1.1 google',
      Host: 'app.thinker.example.com',
      Connection: 'keep-alive',
      'Accept-Encoding': 'gzip',
      'Content-Length': '143',
    });
    expect(result).toEqual({
      'x-forwarded-for': '193.33.57.199, 10.0.0.1',
      'x-forwarded-host': 'app.thinker.example.com',
      'x-forwarded-proto': 'https',
      'x-real-ip': '193.33.57.199',
      forwarded: 'for="193.33.57.199";proto=https',
      via: '1.1 google',
      host: 'app.thinker.example.com',
      connection: 'keep-alive',
      'accept-encoding': 'gzip',
      'content-length': '143',
    });
  });

  it('keeps headers with empty values', () => {
    expect(sanitizeRequestHeaders({ 'x-blank': '   ' })).toEqual({ 'x-blank': '' });
  });

  it('flattens array values with comma-space separator', () => {
    expect(sanitizeRequestHeaders({ 'x-multi': ['a', 'b', 'c'] })).toEqual({
      'x-multi': 'a, b, c',
    });
  });

  it('skips headers with null/undefined values', () => {
    expect(sanitizeRequestHeaders({ 'x-keep': 'yes', 'x-null': undefined })).toEqual({
      'x-keep': 'yes',
    });
  });

  it('strips control characters and trims whitespace', () => {
    expect(sanitizeRequestHeaders({ 'x-dirty': '  hello\u0001world\u007f  ' })).toEqual({
      'x-dirty': 'helloworld',
    });
  });

  it('truncates values longer than 8192 bytes with an ellipsis, by byte length', () => {
    const value = sanitizeRequestHeaders({ 'x-big': '🦞'.repeat(4000) })!['x-big'];
    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(8192);
    expect(value.endsWith('…')).toBe(true);
    expect(value).not.toContain('�');
  });

  it('caps the total number of headers at 200', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 300; i++) headers[`x-h-${i}`] = 'v';
    expect(Object.keys(sanitizeRequestHeaders(headers)!).length).toBe(200);
  });

  it('respects the 64 KB total byte budget, counting JSON escapes', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 30; i++) headers[`x-h-${i}`] = '"'.repeat(4000);
    const result = sanitizeRequestHeaders(headers);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(65536);
    expect(Object.keys(result!).length).toBeLessThan(30);
  });
});

describe('receivedHeaders', () => {
  it('rebuilds headers from rawHeaders, ignoring values stamped by middleware', () => {
    const result = receivedHeaders({
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-thinker-client-ip': '1.2.3.4' },
      rawHeaders: ['X-Forwarded-For', '1.2.3.4', 'Host', 'a.example', 'X-Dup', 'a', 'x-dup', 'b'],
    });
    expect(result).toEqual({
      'x-forwarded-for': '1.2.3.4',
      host: 'a.example',
      'x-dup': ['a', 'b'],
    });
  });

  it('falls back to headers when rawHeaders is missing', () => {
    const headers = { host: 'a.example' };
    expect(receivedHeaders({ headers })).toBe(headers);
  });
});

describe('recordedRequestHeaders', () => {
  it('stores the request line as pseudo-headers ahead of the received headers', () => {
    const result = recordedRequestHeaders({
      method: 'post',
      originalUrl: '/v1/messages?beta=true',
      httpVersion: '1.1',
      headers: {},
      rawHeaders: ['Host', 'a.example'],
    });
    expect(result).toEqual({
      ':method': 'POST',
      ':path': '/v1/messages?beta=true',
      ':version': 'HTTP/1.1',
      host: 'a.example',
    });
    expect(Object.keys(result!)[0]).toBe(':method');
  });

  it('redacts credential query parameters in the path', () => {
    expect(
      requestLineHeaders({ method: 'GET', originalUrl: '/v1/models?key=abc&x=1&api_key=' }),
    ).toEqual({ ':method': 'GET', ':path': '/v1/models?key=[REDACTED]&x=1&api_key=[REDACTED]' });
  });
});
