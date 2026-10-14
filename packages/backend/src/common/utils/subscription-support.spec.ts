import { describe, expect, it } from '@jest/globals';
import { isThinkerUsableProvider, isSupportedSubscriptionProvider } from './subscription-support';

describe('subscription-support helpers', () => {
  it('recognizes canonical subscription provider ids', () => {
    expect(isSupportedSubscriptionProvider('gemini')).toBe(true);
    expect(isThinkerUsableProvider({ provider: 'gemini', auth_type: 'subscription' })).toBe(true);
  });

  it('recognizes subscription provider aliases', () => {
    expect(isSupportedSubscriptionProvider('google')).toBe(true);
    expect(isThinkerUsableProvider({ provider: 'google', auth_type: 'subscription' })).toBe(true);
  });

  it('keeps non-subscription auth records usable regardless of provider support', () => {
    expect(isThinkerUsableProvider({ provider: 'deepseek', auth_type: 'api_key' })).toBe(true);
    expect(isThinkerUsableProvider({ provider: 'deepseek', auth_type: null })).toBe(true);
  });

  it('rejects unsupported subscription providers', () => {
    expect(isSupportedSubscriptionProvider('deepseek')).toBe(false);
    expect(isThinkerUsableProvider({ provider: 'deepseek', auth_type: 'subscription' })).toBe(
      false,
    );
  });
});
