import { signRootToken, verifyRootToken } from './root-token';

// Fixed vector shared with packages/cli/src/root-token.spec.ts.
const VECTOR = 'thk_root_v1.1000.YUBiLmM.9ntq3kRCl1h0ADwpr5jHC3g0hLPRVO4Aj0pcSAvfnM4';
const SECRET = 'x'.repeat(40);

describe('root token', () => {
  it('signs the shared vector', () => {
    expect(signRootToken(SECRET, 'a@b.c', 1000)).toBe(VECTOR);
  });

  it('verifies inside the window and reads the email', () => {
    expect(verifyRootToken(VECTOR, [SECRET], 1100)).toEqual({ ok: true, email: 'a@b.c' });
  });

  it('accepts the previous key during rotation', () => {
    expect(verifyRootToken(VECTOR, ['y'.repeat(40), SECRET], 1000).ok).toBe(true);
  });

  it('rejects outside the window, a wrong key and a tampered token', () => {
    expect(verifyRootToken(VECTOR, [SECRET], 1000 + 301)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyRootToken(VECTOR, ['y'.repeat(40)], 1000)).toEqual({
      ok: false,
      reason: 'signature',
    });
    expect(verifyRootToken(VECTOR.replace('YUBiLmM', 'YUBiLmQ'), [SECRET], 1000).ok).toBe(false);
    expect(verifyRootToken('thk_root_v1.x', [SECRET], 1000).ok).toBe(false);
  });
});
