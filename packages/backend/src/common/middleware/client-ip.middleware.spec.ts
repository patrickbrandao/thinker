import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SOURCE_HEADER,
  PEER_IP_HEADER,
  loadTrustedProxies,
  setTrustedProxies,
} from '../utils/client-ip';
import { requestReceivedAtMs } from '../utils/request-received';
import { clientIpMiddleware } from './client-ip.middleware';

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
  headersDistinct: Record<string, string[]>;
  socket: { remoteAddress: string | undefined };
  ip?: string;
}

function request(
  peer: string | undefined,
  headers: Record<string, string | string[]> = {},
): FakeReq {
  const distinct: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(headers))
    distinct[k.toLowerCase()] = Array.isArray(v) ? v : [v];
  return {
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    headersDistinct: distinct,
    socket: { remoteAddress: peer },
    ip: 'express-default',
  };
}

function run(req: FakeReq) {
  const next = jest.fn();
  clientIpMiddleware(req as unknown as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
}

const resetProxies = () => setTrustedProxies(loadTrustedProxies(undefined));

beforeEach(resetProxies);
afterAll(resetProxies);
afterEach(() => jest.restoreAllMocks());

describe('clientIpMiddleware', () => {
  it('uses the TCP peer when it is not a trusted proxy and ignores spoofed forwarding headers', () => {
    const req = run(
      request('45.80.10.20', { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' }),
    );
    expect(req.ip).toBe('45.80.10.20');
    expect(req.headers[CLIENT_IP_HEADER]).toBe('45.80.10.20');
    expect(req.headers[CLIENT_IP_SOURCE_HEADER]).toBe('tcp');
    expect(req.headers[PEER_IP_HEADER]).toBe('45.80.10.20');
  });

  it('reads X-Forwarded-For behind a trusted (private) proxy', () => {
    const req = run(request('172.18.0.5', { 'x-forwarded-for': '45.80.10.20' }));
    expect(req.ip).toBe('45.80.10.20');
    expect(req.headers[CLIENT_IP_SOURCE_HEADER]).toBe('x-forwarded-for');
    expect(req.headers[PEER_IP_HEADER]).toBe('172.18.0.5');
  });

  it('walks X-Forwarded-For right to left, so a client-prepended address does not win', () => {
    const req = run(request('172.18.0.5', { 'x-forwarded-for': '6.6.6.6, 45.80.10.20' }));
    expect(req.ip).toBe('45.80.10.20');
  });

  it('falls back to X-Real-IP, then to the peer', () => {
    expect(run(request('10.0.0.3', { 'x-real-ip': '45.80.10.20' })).ip).toBe('45.80.10.20');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const bare = run(request('10.0.0.3'));
    expect(bare.ip).toBe('10.0.0.3');
    expect(bare.headers[CLIENT_IP_SOURCE_HEADER]).toBe('tcp');
  });

  it('overwrites internal headers the client sent, so they cannot be forged', () => {
    const req = run(
      request('45.80.10.20', {
        [CLIENT_IP_HEADER]: '1.1.1.1',
        [CLIENT_IP_SOURCE_HEADER]: 'x-forwarded-for',
        [PEER_IP_HEADER]: '2.2.2.2',
      }),
    );
    expect(req.headers[CLIENT_IP_HEADER]).toBe('45.80.10.20');
    expect(req.headers[CLIENT_IP_SOURCE_HEADER]).toBe('tcp');
    expect(req.headers[PEER_IP_HEADER]).toBe('45.80.10.20');
  });

  it('honors TRUSTED_PROXIES: a private peer outside the explicit list is not trusted', () => {
    setTrustedProxies(loadTrustedProxies('203.0.113.0/24'));
    const untrusted = run(request('10.0.0.3', { 'x-forwarded-for': '45.80.10.20' }));
    expect(untrusted.ip).toBe('10.0.0.3');
    expect(untrusted.headers[CLIENT_IP_SOURCE_HEADER]).toBe('tcp');

    const trusted = run(request('203.0.113.7', { 'x-forwarded-for': '45.80.10.20' }));
    expect(trusted.ip).toBe('45.80.10.20');
    expect(trusted.headers[CLIENT_IP_SOURCE_HEADER]).toBe('x-forwarded-for');
  });

  it('stamps the receive time once, before anything else reads the request', () => {
    jest.spyOn(Date, 'now').mockReturnValue(5_000);
    const req = run(request('45.80.10.20'));
    expect(requestReceivedAtMs(req as never, 1)).toBe(5_000);
  });

  it('defines req.ip as an own, overridable property', () => {
    const req = run(request('45.80.10.20'));
    const descriptor = Object.getOwnPropertyDescriptor(req, 'ip')!;
    expect(descriptor.value).toBe('45.80.10.20');
    expect(descriptor.configurable).toBe(true);
    expect(descriptor.enumerable).toBe(true);
  });

  it('resolves once: running twice keeps the first answer', () => {
    const req = request('172.18.0.5', { 'x-forwarded-for': '45.80.10.20' });
    run(req);
    req.headers['x-forwarded-for'] = '9.9.9.9';
    req.headersDistinct['x-forwarded-for'] = ['9.9.9.9'];
    run(req);
    expect(req.ip).toBe('45.80.10.20');
  });

  it('handles a missing socket address without throwing', () => {
    const req = run(request(undefined, { 'x-forwarded-for': '45.80.10.20' }));
    expect(req.ip).toBe('unknown');
    expect(req.headers[PEER_IP_HEADER]).toBe('unknown');
  });

  describe('missing forwarding header warning', () => {
    it('warns once per proxy address per minute', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const now = jest.spyOn(Date, 'now');
      const peer = '172.30.1.1';

      now.mockReturnValue(1_000_000);
      run(request(peer));
      run(request(peer));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(`peer_ip=${peer}`);

      now.mockReturnValue(1_000_000 + 59_000);
      run(request(peer));
      expect(warn).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 61_000);
      run(request(peer));
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('rate-limits each proxy address separately', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Date, 'now').mockReturnValue(9_000_000);
      run(request('172.30.2.1'));
      run(request('172.30.2.2'));
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('stays quiet when the proxy did send a header, or the peer is not a proxy', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Date, 'now').mockReturnValue(20_000_000);
      run(request('172.30.3.1', { 'x-forwarded-for': '45.80.10.20' }));
      run(request('45.80.10.99'));
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
