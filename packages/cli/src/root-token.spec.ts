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

  it('is never minted for a remote host (no audience: it could be replayed here)', () => {
    const key = 'x'.repeat(40);
    expect(
      resolveTarget('https://other.example.com', { THINKER_ENCRYPTION_KEY: key }, {}),
    ).toMatchObject({ source: null, apiKey: null });
    expect(
      resolveTarget(
        undefined,
        { THINKER_ENCRYPTION_KEY: key },
        { activeHost: 'http://10.0.0.5:2099' },
      ),
    ).toMatchObject({ source: null });
    expect(
      resolveTarget(
        'https://other.example.com',
        { THINKER_ENCRYPTION_KEY: key, THINKER_ROOT_REMOTE: '1' },
        {},
      ).source,
    ).toBe('root');
    expect(resolveTarget('http://127.0.0.1:2099', { THINKER_ENCRYPTION_KEY: key }, {}).source).toBe(
      'root',
    );
  });

  it('targets PORT inside the server environment (docker exec with a custom port)', () => {
    const t = resolveTarget(
      undefined,
      { THINKER_ENCRYPTION_KEY: 'x'.repeat(40), PORT: '3000' },
      {},
    );
    expect(t.origin).toBe('http://localhost:3000');
    expect(t.source).toBe('root');
    expect(resolveTarget(undefined, { PORT: '3000' }, {}).origin).toBe('http://localhost:2099');
  });
});
