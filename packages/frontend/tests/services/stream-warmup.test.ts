import { describe, it, expect } from 'vitest';
import {
  idleMsToSecondsInput,
  parseIdleSeconds,
  parseWarmupSeconds,
  warmupMsToSecondsInput,
} from '../../src/services/stream-warmup';

describe('stream warm-up seconds input (#244)', () => {
  it('converts seconds to ms and empty to null', () => {
    expect(parseWarmupSeconds('60')).toBe(60_000);
    expect(parseWarmupSeconds(' 1.5 ')).toBe(1_500);
    expect(parseWarmupSeconds('')).toBeNull();
  });

  it('rejects values outside 1..600 seconds', () => {
    expect(parseWarmupSeconds('0.5')).toBeUndefined();
    expect(parseWarmupSeconds('601')).toBeUndefined();
    expect(parseWarmupSeconds('abc')).toBeUndefined();
  });

  it('renders stored ms as seconds', () => {
    expect(warmupMsToSecondsInput(45_000)).toBe('45');
    expect(warmupMsToSecondsInput(null)).toBe('');
  });
});

describe('stream idle timeout seconds input', () => {
  it('converts seconds to ms and empty to null', () => {
    expect(parseIdleSeconds('180')).toBe(180_000);
    expect(parseIdleSeconds('3600')).toBe(3_600_000);
    expect(parseIdleSeconds('')).toBeNull();
  });

  it('rejects values outside 1..3600 seconds', () => {
    expect(parseIdleSeconds('0.5')).toBeUndefined();
    expect(parseIdleSeconds('3601')).toBeUndefined();
    expect(parseIdleSeconds('abc')).toBeUndefined();
  });

  it('renders stored ms as seconds', () => {
    expect(idleMsToSecondsInput(240_000)).toBe('240');
    expect(idleMsToSecondsInput(undefined)).toBe('');
  });
});
