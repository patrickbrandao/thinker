import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCursorPagination } from '../../src/services/cursor-pagination';

function setup(pageSize?: number) {
  return renderHook(() => useCursorPagination(pageSize)).result;
}

describe('useCursorPagination', () => {
  it('starts on page 1 with no cursor', () => {
    const pager = setup(50);
    expect(pager.current.currentPage).toBe(1);
    expect(pager.current.currentCursor).toBeUndefined();
    expect(pager.current.hasNextPage).toBe(false);
    expect(pager.current.pageSize).toBe(50);
  });

  it('enables next after recordResponse with cursor', () => {
    const pager = setup(50);
    act(() => pager.current.recordResponse('cursor-page-2'));
    expect(pager.current.hasNextPage).toBe(true);
  });

  it('does not enable next when recordResponse receives null', () => {
    const pager = setup(50);
    act(() => pager.current.recordResponse(null));
    expect(pager.current.hasNextPage).toBe(false);
  });

  it('navigates to next page with correct cursor', () => {
    const pager = setup(50);
    act(() => pager.current.recordResponse('cursor-page-2'));
    act(() => pager.current.nextPage());
    expect(pager.current.currentPage).toBe(2);
    expect(pager.current.currentCursor).toBe('cursor-page-2');
  });

  it('navigates back to previous page', () => {
    const pager = setup(50);
    act(() => pager.current.recordResponse('cursor-page-2'));
    act(() => pager.current.nextPage());
    act(() => pager.current.previousPage());
    expect(pager.current.currentPage).toBe(1);
    expect(pager.current.currentCursor).toBeUndefined();
  });

  it('cursor history works across multiple pages', () => {
    const pager = setup(10);
    act(() => pager.current.recordResponse('cursor-2'));
    act(() => pager.current.nextPage());
    act(() => pager.current.recordResponse('cursor-3'));
    act(() => pager.current.nextPage());
    expect(pager.current.currentPage).toBe(3);
    expect(pager.current.currentCursor).toBe('cursor-3');
    act(() => pager.current.previousPage());
    expect(pager.current.currentPage).toBe(2);
    expect(pager.current.currentCursor).toBe('cursor-2');
    act(() => pager.current.previousPage());
    expect(pager.current.currentPage).toBe(1);
    expect(pager.current.currentCursor).toBeUndefined();
  });

  it('previousPage is no-op on page 1', () => {
    const pager = setup(50);
    act(() => pager.current.previousPage());
    expect(pager.current.currentPage).toBe(1);
  });

  it('nextPage is no-op when no next cursor', () => {
    const pager = setup(50);
    act(() => pager.current.nextPage());
    expect(pager.current.currentPage).toBe(1);
  });

  it('resetPage clears all state', () => {
    const pager = setup(50);
    act(() => pager.current.recordResponse('cursor-2'));
    act(() => pager.current.nextPage());
    act(() => pager.current.recordResponse('cursor-3'));
    act(() => pager.current.nextPage());
    act(() => pager.current.resetPage());
    expect(pager.current.currentPage).toBe(1);
    expect(pager.current.currentCursor).toBeUndefined();
    expect(pager.current.hasNextPage).toBe(false);
  });

  it('uses default page size of 50', () => {
    const pager = setup();
    expect(pager.current.pageSize).toBe(50);
  });
});
