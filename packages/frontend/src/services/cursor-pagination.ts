import { useCallback, useState } from 'react';

export interface CursorPagination {
  currentPage: number;
  currentCursor: string | undefined;
  hasNextPage: boolean;
  previousPage: () => void;
  nextPage: () => void;
  recordResponse: (nextCursor: string | null | undefined) => void;
  resetPage: () => void;
  pageSize: number;
}

export function useCursorPagination(pageSize = 50): CursorPagination {
  const [state, setState] = useState<{
    stack: (string | undefined)[];
    index: number;
    hasNext: boolean;
  }>({ stack: [undefined], index: 0, hasNext: false });

  const recordResponse = useCallback((nextCursor: string | null | undefined) => {
    setState((prev) => {
      if (!nextCursor) return prev.hasNext ? { ...prev, hasNext: false } : prev;
      const stack = [...prev.stack];
      stack[prev.index + 1] = nextCursor;
      return { ...prev, stack, hasNext: true };
    });
  }, []);

  return {
    currentPage: state.index + 1,
    currentCursor: state.stack[state.index],
    hasNextPage: state.hasNext,
    previousPage: () =>
      setState((prev) => (prev.index <= 0 ? prev : { ...prev, index: prev.index - 1 })),
    nextPage: () => setState((prev) => (prev.hasNext ? { ...prev, index: prev.index + 1 } : prev)),
    recordResponse,
    resetPage: () => setState({ stack: [undefined], index: 0, hasNext: false }),
    pageSize,
  };
}
