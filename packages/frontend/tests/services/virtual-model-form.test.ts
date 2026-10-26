import { describe, it, expect } from 'vitest';
import {
  mapVirtualModelError,
  nonStreamingRoutes,
  previewShadows,
  virtualModelNameError,
} from '../../src/services/virtual-model-form';
import { ApiError } from '../../src/services/api/core';
import type { AvailableModel } from '../../src/services/api';

const model = (model_name: string, provider: string, stream = true): AvailableModel => ({
  model_name,
  provider,
  input_price_per_token: null,
  output_price_per_token: null,
  context_window: 128000,
  capability_reasoning: false,
  capability_code: false,
  capabilities: stream ? ['stream'] : [],
  quality_score: 1,
});

describe('virtualModelNameError', () => {
  it('accepts names the backend accepts', () => {
    for (const ok of ['deepseek', 'deepseek/flash', 'xxx/yyy', 'a.b_c:d-e', 'A'.repeat(64)]) {
      expect(virtualModelNameError(ok, [])).toBeUndefined();
    }
  });

  it('rejects empty, too long, bad characters, slashes at the edges and //', () => {
    expect(virtualModelNameError('  ', [])).toBe('Name is required');
    expect(virtualModelNameError('a'.repeat(65), [])).toMatch(/64 characters or fewer/);
    for (const bad of ['has space', '/lead', 'trail/', 'a//b', 'quote"', 'emoji🙂']) {
      expect(virtualModelNameError(bad, [])).toMatch(/letters, numbers/);
    }
  });

  it('reserves auto in any spelling', () => {
    expect(virtualModelNameError('AuTo', [])).toMatch(/"auto" is reserved/);
  });

  it('rejects a name another virtual model uses, ignoring case', () => {
    expect(virtualModelNameError('DeepSeek', ['deepseek'])).toMatch(/already uses this name/);
    expect(virtualModelNameError('other', ['deepseek'])).toBeUndefined();
  });
});

describe('previewShadows', () => {
  const models = [model('claude-sonnet-4-5', 'anthropic'), model('gpt-5.5', 'openai')];

  it('matches native and provider/model ids ignoring case', () => {
    expect(previewShadows('Claude-Sonnet-4-5', models)).toEqual(['claude-sonnet-4-5']);
    expect(previewShadows('OpenAI/gpt-5.5', models)).toEqual(['openai/gpt-5.5']);
    expect(previewShadows('deepseek', models)).toEqual([]);
    expect(previewShadows('  ', models)).toEqual([]);
  });
});

describe('nonStreamingRoutes', () => {
  it('lists chain routes whose model cannot stream', () => {
    const models = [model('a', 'p'), model('b', 'p', false)];
    expect(
      nonStreamingRoutes(
        [
          { route: { model: 'a' }, position: 'Primary' },
          { route: { model: 'b' }, position: 'Fallback 1' },
          { route: { model: 'unknown' }, position: 'Fallback 2' },
        ],
        models,
      ),
    ).toEqual([
      { model: 'b', position: 'Fallback 1' },
      { model: 'unknown', position: 'Fallback 2' },
    ]);
  });
});

describe('mapVirtualModelError', () => {
  it('puts a 409 under the name field', () => {
    const err = new ApiError('A virtual model named "x" already exists on this agent', 409);
    expect(mapVirtualModelError(err, ['x'])).toEqual({ name: err.message, invalidModels: [] });
  });

  it('puts a name-rule 400 under the name field', () => {
    const err = new ApiError('"auto" is reserved and cannot be used as a virtual model name', 400);
    expect(mapVirtualModelError(err, []).name).toBe(err.message);
    expect(mapVirtualModelError(new ApiError('Name is required', 400), []).name).toBe(
      'Name is required',
    );
  });

  it('highlights the fallback a 400 names and keeps the wording', () => {
    const err = new ApiError(
      'Cannot resolve fallback model "gpt-x" to a single connected provider. Pass an explicit (provider, authType, model) route, or connect exactly one provider that offers this model.',
      400,
    );
    expect(mapVirtualModelError(err, ['claude', 'gpt-x'])).toEqual({
      general: err.message,
      invalidModels: ['gpt-x'],
    });
  });

  it('falls back to a general message for other failures', () => {
    expect(mapVirtualModelError(new Error('Network down'), ['a'])).toEqual({
      general: 'Network down',
      invalidModels: [],
    });
    expect(mapVirtualModelError('weird', []).general).toMatch(/Something went wrong/);
  });
});
