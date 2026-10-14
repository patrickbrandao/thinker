import { Logger } from '@nestjs/common';
import { SetupTokenService } from './setup-token.service';

describe('SetupTokenService', () => {
  const query = jest.fn();
  let warn: jest.SpyInstance;
  let service: SetupTokenService;

  beforeEach(() => {
    query.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    service = new SetupTokenService({ query } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('issues and logs a token at boot when no user exists', async () => {
    query.mockResolvedValue([{ exists: false }]);
    await service.onApplicationBootstrap();
    expect(service.hasToken).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/one-time setup token: [\w-]{32}$/));
  });

  it('issues nothing at boot when an admin already exists', async () => {
    query.mockResolvedValue([{ exists: true }]);
    await service.onApplicationBootstrap();
    expect(service.hasToken).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('issues nothing when the user table cannot be read', async () => {
    query.mockRejectedValue(new Error('relation "user" does not exist'));
    await service.onApplicationBootstrap();
    expect(service.hasToken).toBe(false);
  });

  it('accepts only the issued token, until it is consumed', () => {
    const token = service.issue();
    expect(service.verify(token)).toBe(true);
    expect(service.verify(`${token}x`)).toBe(false);
    expect(service.verify('')).toBe(false);
    expect(service.verify(undefined)).toBe(false);
    service.consume();
    expect(service.verify(token)).toBe(false);
  });

  it('rejects everything when no token was issued', () => {
    expect(service.verify('anything')).toBe(false);
  });

  it('ensureIssued keeps a pending token and issues one when none is pending', () => {
    const token = service.issue();
    service.ensureIssued();
    expect(service.verify(token)).toBe(true);
    service.consume();
    service.ensureIssued();
    expect(service.hasToken).toBe(true);
    expect(service.verify(token)).toBe(false);
  });

  it('generates a different token each time', () => {
    expect(service.issue()).not.toBe(service.issue());
  });
});
