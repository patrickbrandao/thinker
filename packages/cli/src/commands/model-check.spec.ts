import { ApiClient } from '../client';
import { CliError } from '../errors';
import { assertModelsDiscovered } from './model-check';
import { fetchStub } from '../../test/helpers';

const HOST = 'http://localhost:2099';

interface Row {
  model_name?: unknown;
  provider?: string;
  auth_type?: string;
}

function setup(body: unknown, status = 200) {
  const stub = fetchStub([{ status, body }]);
  const client = new ApiClient({ origin: HOST, apiKey: 'k', fetchImpl: stub.impl });
  return { client, calls: stub.calls };
}

const row = (model_name: string, provider?: string, auth_type?: string): Row => ({
  model_name,
  ...(provider ? { provider } : {}),
  ...(auth_type ? { auth_type } : {}),
});

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    return error as CliError;
  }
  throw new Error('expected assertModelsDiscovered to reject');
}

describe('assertModelsDiscovered', () => {
  describe('short circuits', () => {
    it('returns a copy of the models without any request when forced', async () => {
      const { client, calls } = setup([]);
      const input = ['a', 'b'];
      const out = await assertModelsDiscovered(client, 'john', input, true, 'openai');
      expect(out).toEqual(['a', 'b']);
      expect(out).not.toBe(input);
      expect(calls).toHaveLength(0);
    });

    it('returns an empty list without any request when there are no models', async () => {
      const { client, calls } = setup([]);
      expect(await assertModelsDiscovered(client, 'john', [], false)).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('discovery request', () => {
    it('reads the agent available-models, url-encoding the agent', async () => {
      const { client, calls } = setup([row('gpt-5')]);
      await assertModelsDiscovered(client, 'my agent/x', ['gpt-5'], false);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('GET');
      expect(calls[0].url).toBe(`${HOST}/api/v1/routing/my%20agent%2Fx/available-models`);
    });

    it('propagates a server failure', async () => {
      const { client } = setup({ message: 'nope' }, 500);
      await expect(assertModelsDiscovered(client, 'john', ['a'], false)).rejects.toMatchObject({
        status: 500,
      });
    });

    it.each([
      ['a non-array body', { models: ['a'] }],
      ['a null body', null],
    ])('treats %s as an empty catalog', async (_l, body) => {
      const { client } = setup(body);
      expect((await failure(assertModelsDiscovered(client, 'john', ['a'], false))).code).toBe(
        'unknown_model',
      );
    });

    it('ignores rows with a missing, empty or non-string model name', async () => {
      const { client } = setup([
        null,
        'text',
        {},
        { model_name: '' },
        { model_name: 7 },
        row('real'),
      ]);
      expect(await assertModelsDiscovered(client, 'john', ['real'], false)).toEqual(['real']);
      const { client: c2 } = setup([{ model_name: 7 }, { model_name: '' }]);
      expect((await failure(assertModelsDiscovered(c2, 'john', ['7'], false))).code).toBe(
        'unknown_model',
      );
    });
  });

  describe('name-only check (no provider)', () => {
    it('accepts discovered models and returns them unchanged', async () => {
      const { client } = setup([row('a'), row('b')]);
      expect(await assertModelsDiscovered(client, 'john', ['a', 'b'], false)).toEqual(['a', 'b']);
    });

    it('rejects an undiscovered model and names it, the agent and the escape hatches', async () => {
      const { client } = setup([row('a')]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['a', 'ghost', 'phantom'], false),
      );
      expect(err).toBeInstanceOf(CliError);
      expect(err.code).toBe('unknown_model');
      expect(err.message).toBe('Not in the models discovered for "john": ghost, phantom');
      expect(err.hint).toContain('--force');
      expect(err.hint).toContain('thinker provider refresh');
      expect(err.hint).toContain('thinker models john');
    });

    it('is case-sensitive about model ids', async () => {
      const { client } = setup([row('GPT-5')]);
      expect((await failure(assertModelsDiscovered(client, 'john', ['gpt-5'], false))).code).toBe(
        'unknown_model',
      );
    });

    it('does not mutate its input', async () => {
      const { client } = setup([row('a')]);
      const input = ['a'];
      const out = await assertModelsDiscovered(client, 'john', input, false);
      expect(out).not.toBe(input);
      expect(input).toEqual(['a']);
    });
  });

  describe('primary route pinned to a provider', () => {
    it('accepts a model discovered under that provider', async () => {
      const { client } = setup([
        row('gpt-5', 'openai', 'api_key'),
        row('claude', 'anthropic', 'api_key'),
      ]);
      expect(await assertModelsDiscovered(client, 'john', ['gpt-5'], false, 'openai')).toEqual([
        'gpt-5',
      ]);
    });

    it('resolves provider aliases to the catalog id', async () => {
      const { client } = setup([row('gemini-3', 'gemini', 'api_key')]);
      expect(await assertModelsDiscovered(client, 'john', ['gemini-3'], false, 'Google')).toEqual([
        'gemini-3',
      ]);
    });

    it('rejects a model that only exists under another provider, naming the provider', async () => {
      const { client } = setup([row('claude', 'anthropic', 'api_key')]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['claude'], false, 'openai'),
      );
      expect(err.code).toBe('unknown_model');
      expect(err.message).toBe('Not in the models discovered for "john" under openai: claude');
    });

    it('accepts a provider-qualified primary and writes the discovered spelling', async () => {
      const { client } = setup([row('gpt-5', 'openai', 'api_key')]);
      expect(
        await assertModelsDiscovered(client, 'john', ['openai/gpt-5'], false, 'openai'),
      ).toEqual(['gpt-5']);
    });

    it('keeps the provider-qualified spelling when that is what discovery exposes', async () => {
      const { client } = setup([row('openai/gpt-5', 'openai', 'api_key')]);
      expect(
        await assertModelsDiscovered(client, 'john', ['openai/gpt-5'], false, 'openai'),
      ).toEqual(['openai/gpt-5']);
    });

    it('enforces nothing provider-specific when discovery rows carry no provider', async () => {
      const { client } = setup([row('claude')]);
      expect(await assertModelsDiscovered(client, 'john', ['claude'], false, 'openai')).toEqual([
        'claude',
      ]);
    });

    it('falls back to a name-only check for a custom or unknown provider', async () => {
      const { client } = setup([row('m', 'custom:abc', 'api_key')]);
      expect(await assertModelsDiscovered(client, 'john', ['m'], false, 'custom:abc')).toEqual([
        'm',
      ]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['zzz'], false, 'custom:abc'),
      );
      expect(err.code).toBe('unknown_model');
      expect(err.message).not.toContain('under');
    });
  });

  describe('auth type', () => {
    const rows = [row('gpt-5', 'openai', 'api_key'), row('gpt-5', 'openai', 'subscription')];

    it('accepts the requested auth type when discovered under it', async () => {
      const { client } = setup(rows);
      expect(
        await assertModelsDiscovered(client, 'john', ['gpt-5'], false, 'openai', 'subscription'),
      ).toEqual(['gpt-5']);
    });

    it('reports a mismatch and hints the discovered auth type', async () => {
      const { client } = setup([row('gpt-5', 'openai', 'api_key')]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['gpt-5'], false, 'openai', 'subscription'),
      );
      expect(err.code).toBe('auth_type_mismatch');
      expect(err.message).toBe(
        'Model "gpt-5" is discovered under auth type api_key, not "subscription"',
      );
      expect(err.hint).toBe('Pass --auth-type api_key');
    });

    it('lists every discovered auth type in the mismatch message', async () => {
      const { client } = setup([
        row('gpt-5', 'openai', 'api_key'),
        row('gpt-5', 'openai', 'local'),
      ]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['gpt-5'], false, 'openai', 'subscription'),
      );
      expect(err.message).toContain('api_key, local');
      expect(err.hint).toBe('Pass --auth-type api_key');
    });

    it('treats a row with no auth_type as api_key when others carry one', async () => {
      const { client } = setup([row('gpt-5', 'openai'), row('x', 'openai', 'subscription')]);
      expect(
        await assertModelsDiscovered(client, 'john', ['gpt-5'], false, 'openai', 'api_key'),
      ).toEqual(['gpt-5']);
    });

    it('skips the auth check when no discovered row carries an auth type', async () => {
      const { client } = setup([row('gpt-5', 'openai')]);
      expect(
        await assertModelsDiscovered(client, 'john', ['gpt-5'], false, 'openai', 'subscription'),
      ).toEqual(['gpt-5']);
    });

    it('does not apply to fallbacks, only the primary route', async () => {
      const { client } = setup([
        row('gpt-5', 'openai', 'api_key'),
        row('fb', 'anthropic', 'subscription'),
      ]);
      expect(
        await assertModelsDiscovered(client, 'john', ['gpt-5', 'fb'], false, 'openai', 'api_key'),
      ).toEqual(['gpt-5', 'fb']);
    });

    describe('custom provider (no catalog id)', () => {
      it('checks the requested auth type against what discovered the primary', async () => {
        const { client } = setup([row('m', 'custom:abc', 'api_key')]);
        const err = await failure(
          assertModelsDiscovered(client, 'john', ['m'], false, 'custom:abc', 'subscription'),
        );
        expect(err.code).toBe('auth_type_mismatch');
        expect(err.hint).toBe('Pass --auth-type api_key');
      });

      it('accepts a matching auth type', async () => {
        const { client } = setup([row('m', 'custom:abc', 'api_key')]);
        expect(
          await assertModelsDiscovered(client, 'john', ['m'], false, 'custom:abc', 'api_key'),
        ).toEqual(['m']);
      });

      it('ignores a same-named model under another provider', async () => {
        const { client } = setup([
          row('m', 'custom:abc', 'api_key'),
          row('m', 'openai', 'subscription'),
        ]);
        expect(
          await assertModelsDiscovered(client, 'john', ['m'], false, 'custom:abc', 'api_key'),
        ).toEqual(['m']);
      });

      it('still checks rows that omit the provider', async () => {
        const { client } = setup([row('m', undefined, 'api_key')]);
        const err = await failure(
          assertModelsDiscovered(client, 'john', ['m'], false, 'custom:abc', 'subscription'),
        );
        expect(err.code).toBe('auth_type_mismatch');
      });

      it('matches a provider-qualified primary through its bare id', async () => {
        const { client } = setup([row('llama', 'custom:abc', 'api_key')]);
        const err = await failure(
          assertModelsDiscovered(
            client,
            'john',
            ['custom:abc/llama'],
            false,
            'custom:abc',
            'local',
          ),
        );
        expect(err.code).toBe('auth_type_mismatch');
      });
    });
  });

  describe('fallbacks', () => {
    it('accepts a bare fallback exposed by a single connection', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
      ]);
      expect(await assertModelsDiscovered(client, 'john', ['main', 'fb'], false, 'openai')).toEqual(
        ['main', 'fb'],
      );
    });

    it('rejects a bare fallback exposed by several connections', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
        row('fb', 'openai', 'subscription'),
      ]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['main', 'fb'], false, 'openai'),
      );
      expect(err.code).toBe('ambiguous_model');
      expect(err.message).toContain('fb');
      expect(err.hint).toContain('provider/model');
    });

    it('treats the same model under two auth types of one provider as ambiguous', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
        row('fb', 'anthropic', 'subscription'),
      ]);
      expect(
        (await failure(assertModelsDiscovered(client, 'john', ['main', 'fb'], false, 'openai')))
          .code,
      ).toBe('ambiguous_model');
    });

    it('resolves a provider-qualified fallback and writes the bare id back', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
        row('fb', 'openai', 'subscription'),
      ]);
      expect(
        await assertModelsDiscovered(client, 'john', ['main', 'anthropic/fb'], false, 'openai'),
      ).toEqual(['main', 'fb']);
    });

    it('rejects a qualified fallback whose provider does not expose the bare id', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
      ]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['main', 'groq/fb'], false, 'openai'),
      );
      expect(err.code).toBe('unknown_model');
      expect(err.message).toContain('groq/fb');
    });

    it('rejects a qualified fallback that stays ambiguous within its provider', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
        row('fb', 'anthropic', 'subscription'),
      ]);
      expect(
        (
          await failure(
            assertModelsDiscovered(client, 'john', ['main', 'anthropic/fb'], false, 'openai'),
          )
        ).code,
      ).toBe('ambiguous_model');
    });

    it('rejects a fallback that is not discovered at all', async () => {
      const { client } = setup([row('main', 'openai', 'api_key')]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['main', 'ghost'], false, 'openai'),
      );
      expect(err.code).toBe('unknown_model');
      expect(err.message).toBe('Not in the models discovered for "john" under openai: ghost');
    });

    it('leaves the primary untouched on failure by throwing before returning anything', async () => {
      const { client } = setup([row('main', 'openai', 'api_key')]);
      await expect(
        assertModelsDiscovered(client, 'john', ['main', 'ghost'], false, 'openai'),
      ).rejects.toBeInstanceOf(CliError);
    });
  });

  describe('error precedence', () => {
    it('reports an auth type mismatch before ambiguity and missing models', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
        row('fb', 'openai', 'api_key'),
      ]);
      const err = await failure(
        assertModelsDiscovered(
          client,
          'john',
          ['main', 'fb', 'ghost'],
          false,
          'openai',
          'subscription',
        ),
      );
      expect(err.code).toBe('auth_type_mismatch');
    });

    it('reports ambiguity before missing models', async () => {
      const { client } = setup([
        row('main', 'openai', 'api_key'),
        row('fb', 'anthropic', 'api_key'),
        row('fb', 'openai', 'api_key'),
      ]);
      const err = await failure(
        assertModelsDiscovered(client, 'john', ['main', 'fb', 'ghost'], false, 'openai'),
      );
      expect(err.code).toBe('ambiguous_model');
    });
  });
});
