import {
  CUSTOM_PROVIDER_ALIAS_PATTERN,
  deriveCustomProviderAlias,
  isReservedCustomProviderAlias,
  normalizeCustomProviderAlias,
} from '../src/custom-provider-alias';
import { SHARED_PROVIDERS } from '../src/providers';

describe('custom provider alias', () => {
  describe('CUSTOM_PROVIDER_ALIAS_PATTERN', () => {
    it.each(['vercel', 'vercel-ai-gateway', 'llama.cpp', 'gw2', 'a'])('accepts %s', (alias) => {
      expect(CUSTOM_PROVIDER_ALIAS_PATTERN.test(alias)).toBe(true);
    });

    it.each(['', 'Vercel', 'vercel ai', 'vercel/ai', '-vercel', 'vercel-', 'a--b', 'a.-b', '.a'])(
      'rejects %j',
      (alias) => {
        expect(CUSTOM_PROVIDER_ALIAS_PATTERN.test(alias)).toBe(false);
      },
    );
  });

  describe('normalizeCustomProviderAlias', () => {
    it('trims and lowercases', () => {
      expect(normalizeCustomProviderAlias('  Vercel-GW ')).toBe('vercel-gw');
    });

    it('maps empty, blank, null and undefined to null', () => {
      expect(normalizeCustomProviderAlias('')).toBeNull();
      expect(normalizeCustomProviderAlias('   ')).toBeNull();
      expect(normalizeCustomProviderAlias(null)).toBeNull();
      expect(normalizeCustomProviderAlias(undefined)).toBeNull();
    });
  });

  describe('isReservedCustomProviderAlias', () => {
    it('reserves the synthetic routes and the custom prefix', () => {
      expect(isReservedCustomProviderAlias('auto')).toBe(true);
      expect(isReservedCustomProviderAlias('manifest')).toBe(true);
      expect(isReservedCustomProviderAlias('custom')).toBe(true);
    });

    it('reserves built-in provider ids and their aliases', () => {
      expect(isReservedCustomProviderAlias('openai')).toBe(true);
      expect(isReservedCustomProviderAlias('google')).toBe(true);
      expect(isReservedCustomProviderAlias('ollama')).toBe(true);
    });

    it('leaves other names free', () => {
      expect(isReservedCustomProviderAlias('vercel-ai-gateway')).toBe(false);
    });

    it('reserves every local runner id that has a native route', () => {
      for (const id of ['ollama', 'ollama-cloud', 'lmstudio', 'llamacpp']) {
        expect(isReservedCustomProviderAlias(id)).toBe(true);
      }
    });

    it('reserves the id of every registry entry, tile-only or not', () => {
      for (const entry of SHARED_PROVIDERS) {
        expect(isReservedCustomProviderAlias(entry.id)).toBe(true);
      }
    });

    it('leaves the display-name aliases of tile-only providers free for the dashboard tile', () => {
      expect(isReservedCustomProviderAlias('llama.cpp')).toBe(false);
      expect(isReservedCustomProviderAlias('llama-cpp')).toBe(false);
      expect(isReservedCustomProviderAlias('lm-studio')).toBe(false);
    });
  });

  describe('deriveCustomProviderAlias', () => {
    it('slugifies a display name', () => {
      expect(deriveCustomProviderAlias('Vercel AI Gateway')).toBe('vercel-ai-gateway');
      expect(deriveCustomProviderAlias('  my_gateway  ')).toBe('my-gateway');
    });

    it('keeps dots so llama.cpp stays recognisable', () => {
      expect(deriveCustomProviderAlias('llama.cpp')).toBe('llama.cpp');
    });

    it('collapses and strips separator runs', () => {
      expect(deriveCustomProviderAlias('--My -- Provider..')).toBe('my-provider');
      expect(deriveCustomProviderAlias('a.-b')).toBe('a.b');
    });

    it('caps the alias at the maximum length without a trailing separator', () => {
      const long = `${'a'.repeat(49)}-bbbbbb`;
      expect(deriveCustomProviderAlias(long)).toBe('a'.repeat(49));
    });

    it('returns null when nothing usable remains', () => {
      expect(deriveCustomProviderAlias('***')).toBeNull();
      expect(deriveCustomProviderAlias('')).toBeNull();
    });

    it('returns null for reserved names so built-in routes stay unambiguous', () => {
      expect(deriveCustomProviderAlias('OpenAI')).toBeNull();
      expect(deriveCustomProviderAlias('auto')).toBeNull();
    });

    it('returns null for names that derive to a native local runner id', () => {
      expect(deriveCustomProviderAlias('LMStudio')).toBeNull();
      expect(deriveCustomProviderAlias('llamacpp')).toBeNull();
      expect(deriveCustomProviderAlias('Ollama')).toBeNull();
    });

    it('still derives the tile names the dashboard uses', () => {
      expect(deriveCustomProviderAlias('LM Studio')).toBe('lm-studio');
      expect(deriveCustomProviderAlias('llama.cpp')).toBe('llama.cpp');
    });
  });
});
