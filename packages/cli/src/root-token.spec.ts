import { signRootToken } from './root-token';
import { resolveTarget } from './config';

// Fixed vector shared with packages/backend/src/common/utils/root-token.spec.ts.
const VECTOR = 'thk_root_v1.1000.YUBiLmM.9ntq3kRCl1h0ADwpr5jHC3g0hLPRVO4Aj0pcSAvfnM4';

describe('root token', () => {
  it('matches the server algorithm', () => {
    expect(signRootToken('x'.repeat(40), 'a@b.c', 1000)).toBe(VECTOR);
  });

  it('is used when THINKER_ENCRYPTION_KEY is set and nothing else is', () => {
    const t = resolveTarget(undefined, { THINKER_ENCRYPTION_KEY: 'x'.repeat(40) }, {});
    expect(t.source).toBe('root');
    expect(t.apiKey).toMatch(/^thk_root_v1\./);
  });

  it('never beats an explicit THINKER_API_KEY', () => {
    const t = resolveTarget(
      undefined,
      { THINKER_ENCRYPTION_KEY: 'x'.repeat(40), THINKER_API_KEY: 'thk_adm_k' },
      {},
    );
    expect(t).toMatchObject({ source: 'env', apiKey: 'thk_adm_k' });
  });
});
