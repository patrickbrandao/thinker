import type { Request } from 'express';
import { getSocketRemoteAddress, isLoopbackIp, isLoopbackPeer } from './local-ip';

const reqWith = (socket: unknown, extra: Record<string, unknown> = {}) =>
  ({ socket, ...extra }) as unknown as Request;

describe('isLoopbackIp', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('%s is loopback', (ip) => {
    expect(isLoopbackIp(ip)).toBe(true);
  });

  it.each([
    '127.0.0.2', // loopback range, but not one of the three literals the bypass accepts
    '10.0.0.1',
    '192.168.1.1',
    '8.8.8.8',
    '::2',
    '::ffff:10.0.0.1',
    'localhost',
    '',
    '127.0.0.1 ',
    '0.0.0.0',
  ])('%p is not loopback', (ip) => {
    expect(isLoopbackIp(ip)).toBe(false);
  });
});

describe('getSocketRemoteAddress', () => {
  it('returns the TCP peer', () => {
    expect(getSocketRemoteAddress(reqWith({ remoteAddress: '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('is undefined without a socket or address', () => {
    expect(getSocketRemoteAddress(reqWith(undefined))).toBeUndefined();
    expect(getSocketRemoteAddress(reqWith({}))).toBeUndefined();
    expect(getSocketRemoteAddress(reqWith({ remoteAddress: null }))).toBeUndefined();
  });

  it('ignores request.ip and forwarded headers, which a client can forge', () => {
    const req = reqWith(
      { remoteAddress: '203.0.113.9' },
      { ip: '127.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1' } },
    );
    expect(getSocketRemoteAddress(req)).toBe('203.0.113.9');
  });
});

describe('isLoopbackPeer', () => {
  it('is true only for a loopback socket', () => {
    expect(isLoopbackPeer(reqWith({ remoteAddress: '127.0.0.1' }))).toBe(true);
    expect(isLoopbackPeer(reqWith({ remoteAddress: '::1' }))).toBe(true);
    expect(isLoopbackPeer(reqWith({ remoteAddress: '::ffff:127.0.0.1' }))).toBe(true);
    expect(isLoopbackPeer(reqWith({ remoteAddress: '203.0.113.9' }))).toBe(false);
  });

  it('cannot be spoofed with a forged request.ip or X-Forwarded-For', () => {
    const forged = reqWith(
      { remoteAddress: '203.0.113.9' },
      { ip: '127.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '::1' } },
    );
    expect(isLoopbackPeer(forged)).toBe(false);
  });

  it('is false when the peer is unknown', () => {
    expect(isLoopbackPeer(reqWith(undefined))).toBe(false);
    expect(isLoopbackPeer(reqWith({}))).toBe(false);
    expect(isLoopbackPeer(reqWith({ remoteAddress: '' }))).toBe(false);
  });
});
