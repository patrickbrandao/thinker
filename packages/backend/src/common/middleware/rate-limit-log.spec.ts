import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimitReachedHandler } from './rate-limit-log';

function makeRes(): Response & { status: jest.Mock; send: jest.Mock } {
  const res = {} as Response & { status: jest.Mock; send: jest.Mock };
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('createRateLimitReachedHandler', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs a structured WARN and sends the default 429 response unchanged', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const handler = createRateLimitReachedHandler('sign-in');
    const req = {
      method: 'POST',
      originalUrl: '/api/auth/sign-in',
      socket: { remoteAddress: '45.80.10.20' },
    } as unknown as Request;
    const res = makeRes();
    const message = { error: 'Too many login attempts. Try again later.' };

    handler(req, res, jest.fn() as unknown as NextFunction, { statusCode: 429, message });

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith(message);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('sign-in');
    expect(line).toContain('POST');
    expect(line).toContain('/api/auth/sign-in');
    expect(line).toContain('client_ip=45.80.10.20 client_ip_source=tcp peer_ip=45.80.10.20');
  });

  it('uses the TCP peer when no proxy is in front', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const handler = createRateLimitReachedHandler('sign-up');
    const req = {
      method: 'POST',
      originalUrl: '/api/auth/sign-up',
      socket: { remoteAddress: '198.51.100.9' },
    } as unknown as Request;

    handler(req, makeRes(), jest.fn() as unknown as NextFunction, {
      statusCode: 429,
      message: 'x',
    });

    expect(warn.mock.calls[0][0] as string).toContain('198.51.100.9');
  });

  it("uses 'unknown' when no socket is available", () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const handler = createRateLimitReachedHandler('verify-email');
    const req = { method: 'POST', originalUrl: '/api/auth/verify-email' } as unknown as Request;

    handler(req, makeRes(), jest.fn() as unknown as NextFunction, {
      statusCode: 429,
      message: 'x',
    });

    expect(warn.mock.calls[0][0] as string).toContain('ip=unknown');
  });
});
