import { ForbiddenException } from '@nestjs/common';
import {
  assertCanUseLocalRunners,
  canUsePrivateDestinations,
  privateUrlPolicy,
} from './private-url-policy';

describe('private URL policy (#78, #102)', () => {
  it('defaults to admin-only', () => {
    expect(privateUrlPolicy({})).toBe('admin-only');
    expect(privateUrlPolicy({ THINKER_PROVIDER_PRIVATE_URLS: 'bogus' })).toBe('admin-only');
  });

  it('admin-only allows owners and the instance admin', () => {
    expect(canUsePrivateDestinations({ role: 'owner' }, {})).toBe(true);
    expect(canUsePrivateDestinations({ role: 'admin', isInstanceAdmin: true }, {})).toBe(true);
    expect(canUsePrivateDestinations({ role: 'admin' }, {})).toBe(false);
    expect(() => assertCanUseLocalRunners({ role: 'admin' }, {})).toThrow(ForbiddenException);
  });

  it('allow and deny override the role', () => {
    const allow = { THINKER_PROVIDER_PRIVATE_URLS: 'allow' };
    const deny = { THINKER_PROVIDER_PRIVATE_URLS: 'deny' };
    expect(canUsePrivateDestinations({ role: 'admin' }, allow)).toBe(true);
    expect(canUsePrivateDestinations({ role: 'owner', isInstanceAdmin: true }, deny)).toBe(false);
  });
});
