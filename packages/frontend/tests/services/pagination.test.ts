import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useClientPagination } from '../../src/services/pagination';

function setup<T>(items: T[], pageSize?: number) {
  return renderHook(({ list }) => useClientPagination(list, pageSize), {
    initialProps: { list: items },
  });
}

describe('useClientPagination', () => {
  it('returns first page items', () => {
    const { result } = setup([1, 2, 3, 4, 5], 3);
    expect(result.current.pageItems).toEqual([1, 2, 3]);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.totalItems).toBe(5);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.hasNextPage).toBe(true);
  });

  it('navigates to next page', () => {
    const { result } = setup([1, 2, 3, 4, 5], 3);
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(2);
    expect(result.current.pageItems).toEqual([4, 5]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('navigates back with previousPage', () => {
    const { result } = setup([1, 2, 3, 4, 5], 3);
    act(() => result.current.nextPage());
    act(() => result.current.previousPage());
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageItems).toEqual([1, 2, 3]);
  });

  it('previousPage is no-op on page 1', () => {
    const { result } = setup([1, 2, 3], 2);
    act(() => result.current.previousPage());
    expect(result.current.currentPage).toBe(1);
  });

  it('nextPage is no-op on last page', () => {
    const { result } = setup([1, 2, 3], 3);
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(1);
  });

  it('clamps page when list shrinks', () => {
    const { result, rerender } = setup([1, 2, 3, 4, 5, 6], 3);
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(2);
    rerender({ list: [1, 2] });
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageItems).toEqual([1, 2]);
  });

  it('resetPage returns to page 1', () => {
    const { result } = setup([1, 2, 3, 4, 5], 2);
    act(() => result.current.nextPage());
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(3);
    act(() => result.current.resetPage());
    expect(result.current.currentPage).toBe(1);
  });

  it('handles empty input', () => {
    const { result } = setup<number>([], 5);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.pageItems).toEqual([]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('handles partial last page', () => {
    const { result } = setup([1, 2, 3, 4], 3);
    expect(result.current.totalPages).toBe(2);
    act(() => result.current.nextPage());
    expect(result.current.pageItems).toEqual([4]);
  });

  it('uses default page size of 25', () => {
    const { result } = setup(Array.from({ length: 60 }, (_, i) => i));
    expect(result.current.pageSize).toBe(25);
    expect(result.current.pageItems.length).toBe(25);
    expect(result.current.totalPages).toBe(3);
  });
});
