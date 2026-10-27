import { describe, it, expect } from 'vitest';
import { validateNewPassword } from '../../src/pages/ChangePassword';

describe('validateNewPassword', () => {
  it('requires 8+ chars, a matching confirmation and a different password', () => {
    expect(validateNewPassword('old', 'short', 'short')).toMatch(/8 characters/);
    expect(validateNewPassword('old', 'longenough', 'different')).toMatch(/do not match/);
    expect(validateNewPassword('samesame1', 'samesame1', 'samesame1')).toMatch(/differ/);
    expect(validateNewPassword('temporary', 'brand-new-pass', 'brand-new-pass')).toBeNull();
  });
});
