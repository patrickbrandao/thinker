import { describe, expect, it } from 'vitest';
import {
  appendSearch,
  buildLoginRedirect,
  buildSocialAuthUrls,
  getAuthDestination,
  isSafeInternalRedirect,
  signedOAuthDestination,
} from '../../src/services/auth-redirects';

describe('auth redirect helpers', () => {
  it('accepts safe internal redirects', () => {
    expect(isSafeInternalRedirect('/messages')).toBe(true);
    expect(isSafeInternalRedirect('/messages?range=30d')).toBe(true);
  });

  it('rejects external or malformed redirects', () => {
    expect(isSafeInternalRedirect(undefined)).toBe(false);
    expect(isSafeInternalRedirect('https://evil.test')).toBe(false);
    expect(isSafeInternalRedirect('//evil.test')).toBe(false);
    expect(isSafeInternalRedirect('/https://evil.test')).toBe(false);
    expect(isSafeInternalRedirect('%2F%2Fevil.test')).toBe(false);
    expect(isSafeInternalRedirect('%')).toBe(false);
  });

  it('uses a safe redirect as the destination', () => {
    expect(getAuthDestination({ redirect: '/messages' })).toBe('/messages');
  });

  it('falls back to home without a safe redirect', () => {
    expect(getAuthDestination({ redirect: 'https://evil.test' })).toBe('/');
    expect(getAuthDestination({})).toBe('/');
  });

  it('ignores the legacy plan intent parameter', () => {
    expect(getAuthDestination({ plan: 'pro' })).toBe('/');
    expect(buildSocialAuthUrls({ plan: 'pro' })).toEqual({
      callbackURL: '/',
      errorCallbackURL: '/login?oauth=failed',
    });
  });

  it('resumes a signed MCP authorization query after sign-in', () => {
    const query =
      '?client_id=https%3A%2F%2Fclient.test%2Fmetadata&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&ba_param=client_id&ba_param=redirect_uri&sig=abc&oauth=failed';
    const destination = signedOAuthDestination(query);
    expect(destination).toBe(
      '/api/auth/oauth2/authorize?client_id=https%3A%2F%2Fclient.test%2Fmetadata&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&ba_param=client_id&ba_param=redirect_uri&sig=abc',
    );
    expect(getAuthDestination({}, query)).toBe(destination);
    expect(buildSocialAuthUrls({}, query)).toEqual({
      callbackURL: destination,
      errorCallbackURL: `/login?${new URLSearchParams(query.slice(1)).toString()}`,
    });
  });

  it('does not treat unsigned OAuth parameters as a sign-in destination', () => {
    expect(
      signedOAuthDestination('?client_id=client&redirect_uri=http%3A%2F%2F127.0.0.1'),
    ).toBeUndefined();
  });

  it('builds encoded login redirects from path and search', () => {
    expect(buildLoginRedirect('/messages', '?range=30d')).toBe(
      '/login?redirect=%2Fmessages%3Frange%3D30d',
    );
  });

  it('appends search strings to cross-links', () => {
    expect(appendSearch('/login', '?redirect=%2Fmessages')).toBe('/login?redirect=%2Fmessages');
    expect(appendSearch('/login', 'redirect=%2Fmessages')).toBe('/login?redirect=%2Fmessages');
    expect(appendSearch('/login')).toBe('/login');
  });

  it('preserves safe redirects in social error callbacks', () => {
    expect(buildSocialAuthUrls({ redirect: '/messages?range=30d' })).toEqual({
      callbackURL: '/messages?range=30d',
      errorCallbackURL: '/login?redirect=%2Fmessages%3Frange%3D30d&oauth=failed',
    });
  });
});
