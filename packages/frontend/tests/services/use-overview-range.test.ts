import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  RANGE_STORAGE_KEY,
  VALID_RANGES,
  useOverviewRange,
  useOverviewColumns,
} from '../../src/services/use-overview-range';

vi.mock('../../src/components/message-table-types.js', () => ({
  COMPACT_COLUMNS: ['status', 'trigger', 'date', 'model'],
}));

describe('use-overview-range', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('RANGE_STORAGE_KEY', () => {
    it('is the expected localStorage key string', () => {
      expect(RANGE_STORAGE_KEY).toBe('thinker_chart_range');
    });
  });

  describe('VALID_RANGES', () => {
    it('contains the supported dashboard ranges', () => {
      expect(VALID_RANGES.has('24h')).toBe(true);
      expect(VALID_RANGES.has('7d')).toBe(true);
      expect(VALID_RANGES.has('30d')).toBe(true);
      expect(VALID_RANGES.has('90d')).toBe(true);
      expect(VALID_RANGES.has('365d')).toBe(true);
    });

    it('does not contain invalid values', () => {
      expect(VALID_RANGES.has('1y')).toBe(false);
      expect(VALID_RANGES.has('')).toBe(false);
    });
  });

  describe('useOverviewRange', () => {
    it('defaults to 30d when localStorage is empty', () => {
      const { result } = renderHook(() => useOverviewRange());
      expect(result.current.range).toBe('30d');
    });

    it('reads saved range from localStorage when valid', () => {
      localStorage.setItem(RANGE_STORAGE_KEY, '365d');
      const { result } = renderHook(() => useOverviewRange());
      expect(result.current.range).toBe('365d');
    });

    it('falls back to 30d when localStorage contains an invalid value', () => {
      localStorage.setItem(RANGE_STORAGE_KEY, 'invalid-range');
      const { result } = renderHook(() => useOverviewRange());
      expect(result.current.range).toBe('30d');
    });

    it('handleRangeChange updates the state and persists to localStorage', () => {
      const { result } = renderHook(() => useOverviewRange());

      act(() => result.current.handleRangeChange('24h'));

      expect(result.current.range).toBe('24h');
      expect(localStorage.getItem(RANGE_STORAGE_KEY)).toBe('24h');
    });

    it('handleRangeChange calls markUserSelected when provided', () => {
      const markUserSelected = vi.fn();
      const { result } = renderHook(() => useOverviewRange({ markUserSelected }));

      act(() => result.current.handleRangeChange('7d'));

      expect(markUserSelected).toHaveBeenCalledTimes(1);
    });

    it('handleRangeChange does not throw when markUserSelected is not provided', () => {
      const { result } = renderHook(() => useOverviewRange());
      expect(() => act(() => result.current.handleRangeChange('24h'))).not.toThrow();
    });

    it('exposes setRange for direct state mutation', () => {
      const { result } = renderHook(() => useOverviewRange());
      act(() => result.current.setRange('7d'));
      expect(result.current.range).toBe('7d');
    });
  });

  describe('useOverviewColumns', () => {
    it('returns COMPACT_COLUMNS (the same set everywhere now that feedback is gone)', () => {
      const { result } = renderHook(() => useOverviewColumns());
      expect(result.current.columns).toEqual(['status', 'trigger', 'date', 'model']);
    });
  });
});
