import {
  SUBSCRIPTION_PROVIDER_CONFIGS,
  SUPPORTED_SUBSCRIPTION_PROVIDER_IDS,
  getSubscriptionCapabilities,
  getSubscriptionKnownModels,
  getSubscriptionKnownModelsMatch,
  getSubscriptionProviderConfig,
  supportsSubscriptionProvider,
} from '../src/subscription';
import { SHARED_PROVIDER_BY_ID_OR_ALIAS } from '../src/providers';

const AUTH_MODES = ['popup_oauth', 'device_code', 'token'];
const entries = Object.entries(SUBSCRIPTION_PROVIDER_CONFIGS);

describe('subscription provider configs: data sanity', () => {
  it('declares at least one provider', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('has unique, lowercase, URL-safe ids (also case-insensitively)', () => {
    const ids = entries.map(([id]) => id);
    expect(new Set(ids.map((id) => id.toLowerCase())).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('only configures providers the shared registry knows', () => {
    for (const [id] of entries) {
      expect(SHARED_PROVIDER_BY_ID_OR_ALIAS.has(id)).toBe(true);
      expect(SHARED_PROVIDER_BY_ID_OR_ALIAS.get(id)?.id).toBe(id);
    }
  });

  it('lists the same ids in SUPPORTED_SUBSCRIPTION_PROVIDER_IDS', () => {
    expect([...SUPPORTED_SUBSCRIPTION_PROVIDER_IDS]).toEqual(entries.map(([id]) => id));
    expect(Object.isFrozen(SUPPORTED_SUBSCRIPTION_PROVIDER_IDS)).toBe(true);
  });

  describe.each(entries)('%s', (id, config) => {
    it('declares subscription support and a label', () => {
      expect(config.supportsSubscription).toBe(true);
      expect(config.subscriptionLabel.trim()).toBe(config.subscriptionLabel);
      expect(config.subscriptionLabel.length).toBeGreaterThan(0);
    });

    it('has a valid auth mode', () => {
      expect(AUTH_MODES).toContain(config.subscriptionAuthMode);
    });

    it('pairs token mode with a key placeholder', () => {
      if (config.subscriptionAuthMode === 'token') {
        expect(config.subscriptionKeyPlaceholder?.trim()).toBeTruthy();
      }
    });

    it('only uses token-only fields in token mode', () => {
      if (config.subscriptionAuthMode !== 'token') {
        expect(config.subscriptionTokenPrefix).toBeUndefined();
        expect(config.subscriptionCommand).toBeUndefined();
      }
    });

    it('has well-formed token prefix and command when set', () => {
      if (config.subscriptionTokenPrefix !== undefined) {
        expect(config.subscriptionTokenPrefix).toMatch(/^\S+$/);
      }
      if (config.subscriptionCommand !== undefined) {
        expect(config.subscriptionCommand.trim()).toBe(config.subscriptionCommand);
        expect(config.subscriptionCommand.length).toBeGreaterThan(0);
      }
    });

    it('has a non-empty, trimmed, duplicate-free known model list when declared', () => {
      if (config.knownModels === undefined) return;
      expect(config.knownModels.length).toBeGreaterThan(0);
      for (const model of config.knownModels) {
        expect(model.length).toBeGreaterThan(0);
        expect(model).toBe(model.trim());
        expect(model).not.toMatch(/\s/);
      }
      const lower = config.knownModels.map((m) => m.toLowerCase());
      expect(lower.filter((m, i) => lower.indexOf(m) !== i)).toEqual([]);
    });

    it('only sets knownModelsMatch alongside a known model list', () => {
      if (config.knownModelsMatch !== undefined) {
        expect(['prefix', 'exact']).toContain(config.knownModelsMatch);
        expect(config.knownModels).toBeDefined();
      }
    });

    it('declares sane capabilities', () => {
      const caps = config.subscriptionCapabilities;
      expect(caps).toBeDefined();
      expect(Number.isInteger(caps!.maxContextWindow)).toBe(true);
      expect(caps!.maxContextWindow).toBeGreaterThan(0);
      expect(typeof caps!.supportsPromptCaching).toBe('boolean');
      expect(typeof caps!.supportsBatching).toBe('boolean');
      for (const [model, window] of Object.entries(caps!.modelContextWindows ?? {})) {
        expect(model.length).toBeGreaterThan(0);
        expect(Number.isInteger(window)).toBe(true);
        expect(window).toBeGreaterThan(0);
      }
    });

    it('keeps per-model windows inside the curated list for exact-match providers', () => {
      if (config.knownModelsMatch !== 'exact') return;
      const known = new Set(config.knownModels);
      for (const model of Object.keys(config.subscriptionCapabilities?.modelContextWindows ?? {})) {
        expect(known.has(model)).toBe(true);
      }
    });

    it('is deeply frozen', () => {
      expect(Object.isFrozen(config)).toBe(true);
      if (config.knownModels) expect(Object.isFrozen(config.knownModels)).toBe(true);
      expect(Object.isFrozen(config.subscriptionCapabilities)).toBe(true);
      if (config.subscriptionCapabilities?.modelContextWindows) {
        expect(Object.isFrozen(config.subscriptionCapabilities.modelContextWindows)).toBe(true);
      }
    });

    it('is reachable through the helpers by its own id', () => {
      expect(getSubscriptionProviderConfig(id)).toBe(config);
      expect(supportsSubscriptionProvider(id)).toBe(true);
      expect(getSubscriptionKnownModels(id)).toBe(config.knownModels ?? null);
      expect(getSubscriptionCapabilities(id)).toBe(config.subscriptionCapabilities ?? null);
      expect(getSubscriptionKnownModelsMatch(id)).toBe(config.knownModelsMatch ?? 'prefix');
    });
  });

  it('refuses mutation of the registry at runtime', () => {
    'use strict';
    expect(() => {
      (SUBSCRIPTION_PROVIDER_CONFIGS as Record<string, unknown>).evil = {};
    }).toThrow(TypeError);
    expect(() => {
      (SUBSCRIPTION_PROVIDER_CONFIGS.anthropic as { subscriptionLabel: string }).subscriptionLabel =
        'x';
    }).toThrow(TypeError);
  });
});

describe('subscription helpers', () => {
  describe('provider id normalization', () => {
    it('is case-insensitive and trims whitespace', () => {
      const config = getSubscriptionProviderConfig('anthropic');
      expect(config).not.toBeNull();
      expect(getSubscriptionProviderConfig('ANTHROPIC')).toBe(config);
      expect(getSubscriptionProviderConfig('  Anthropic \n')).toBe(config);
    });

    it('resolves provider aliases to the canonical config', () => {
      expect(getSubscriptionProviderConfig('z.ai')).toBe(SUBSCRIPTION_PROVIDER_CONFIGS.zai);
      expect(getSubscriptionProviderConfig('mimo')).toBe(SUBSCRIPTION_PROVIDER_CONFIGS.xiaomi);
      expect(getSubscriptionProviderConfig('Xiaomi-MiMo')).toBe(
        SUBSCRIPTION_PROVIDER_CONFIGS.xiaomi,
      );
      expect(getSubscriptionProviderConfig('kimi')).toBe(SUBSCRIPTION_PROVIDER_CONFIGS.moonshot);
      expect(getSubscriptionProviderConfig('command-code')).toBe(
        SUBSCRIPTION_PROVIDER_CONFIGS.commandcode,
      );
      expect(getSubscriptionProviderConfig('opencodego')).toBe(
        SUBSCRIPTION_PROVIDER_CONFIGS['opencode-go'],
      );
    });

    it('returns null for unknown ids', () => {
      for (const id of ['', '   ', 'nope', 'anthropic-extra']) {
        expect(getSubscriptionProviderConfig(id)).toBeNull();
        expect(supportsSubscriptionProvider(id)).toBe(false);
      }
    });

    it('returns null for Object.prototype member names', () => {
      for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
        expect(getSubscriptionProviderConfig(id)).toBeNull();
        expect(supportsSubscriptionProvider(id)).toBe(false);
      }
    });

    it('tolerates a non-string id', () => {
      expect(getSubscriptionProviderConfig(undefined as unknown as string)).toBeNull();
      expect(getSubscriptionProviderConfig(null as unknown as string)).toBeNull();
    });

    it('does not support providers that are API-key only', () => {
      expect(supportsSubscriptionProvider('deepseek')).toBe(false);
      expect(supportsSubscriptionProvider('groq')).toBe(false);
    });
  });

  describe('getSubscriptionKnownModels', () => {
    it('returns the curated list', () => {
      expect(getSubscriptionKnownModels('minimax')).toEqual(['MiniMax-M3.1-Flash']);
    });

    it('returns null for a provider without a list (live discovery) and for unknown ids', () => {
      expect(getSubscriptionKnownModels('qwen')).toBeNull();
      expect(getSubscriptionKnownModels('nope')).toBeNull();
    });
  });

  describe('getSubscriptionKnownModelsMatch', () => {
    it('defaults to prefix when unset or unknown', () => {
      expect(getSubscriptionKnownModelsMatch('anthropic')).toBe('prefix');
      expect(getSubscriptionKnownModelsMatch('nope')).toBe('prefix');
    });

    it('returns exact where configured', () => {
      expect(getSubscriptionKnownModelsMatch('openai')).toBe('exact');
      expect(getSubscriptionKnownModelsMatch('Cline-Pass')).toBe('exact');
    });
  });

  describe('getSubscriptionCapabilities', () => {
    it('returns the capabilities of a provider', () => {
      expect(getSubscriptionCapabilities('ollama-cloud')).toMatchObject({
        maxContextWindow: 128000,
      });
    });

    it('returns null for an unknown provider', () => {
      expect(getSubscriptionCapabilities('nope')).toBeNull();
    });
  });
});
