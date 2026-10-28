import { useMemo, useState } from 'react';

export interface ClientPagination<T> {
  currentPage: number;
  pageItems: T[];
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  previousPage: () => void;
  nextPage: () => void;
  resetPage: () => void;
  pageSize: number;
}

export function useClientPagination<T>(items: T[], pageSize = 25): ClientPagination<T> {
  const [rawPage, setRawPage] = useState(1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, rawPage), totalPages);
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    currentPage,
    pageItems,
    totalItems,
    totalPages,
    hasNextPage: currentPage < totalPages,
    previousPage: () => setRawPage((p) => Math.max(1, Math.min(p, totalPages) - 1)),
    nextPage: () => setRawPage((p) => (p < totalPages ? p + 1 : p)),
    resetPage: () => setRawPage(1),
    pageSize,
  };
}
