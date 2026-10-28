import { t } from '../i18n/index.js';
import { Button } from './ui.js';

/**
 * Props mirror the values returned by `useClientPagination` /
 * `useCursorPagination` (plain values, not accessors).
 */
export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  hasNextPage: boolean;
  isLoading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  hasNextPage,
  isLoading = false,
  onPrevious,
  onNext,
}: PaginationProps) {
  if (!(totalItems > pageSize)) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <nav
      className="pagination flex flex-wrap items-center justify-between gap-3 pt-3"
      role="navigation"
      aria-label={t('ui.pagination.label')}
    >
      <span className="text-xs text-muted">
        {t('ui.pagination.showing', { start, end, total: totalItems })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={currentPage <= 1 || isLoading}
          onClick={onPrevious}
          aria-label={t('ui.pagination.previousAria')}
        >
          {t('ui.pagination.previous')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasNextPage || isLoading}
          onClick={onNext}
          aria-label={t('ui.pagination.nextAria')}
        >
          {t('ui.pagination.next')}
        </Button>
      </div>
    </nav>
  );
}
