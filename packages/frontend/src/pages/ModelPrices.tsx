import { useMemo, useState } from 'react';
import ErrorState from '../components/ErrorState.js';
import InfoTooltip from '../components/InfoTooltip.js';
import ModelPricesFilterBar from '../components/ModelPricesFilterBar.js';
import Pagination from '../components/Pagination.js';
import { providerIcon } from '../components/ProviderIcon.js';
import { Badge, Button, Skel } from '../components/ui.js';
import { getModelPrices } from '../services/api.js';
import { getModelDisplayName, preloadModelDisplayNames } from '../services/model-display.js';
import { useClientPagination } from '../services/pagination.js';
import { resolveProviderId } from '../services/routing-utils.js';
import { usd } from '../services/formatters.js';
import { useResource } from '../lib/use-resource.js';
import { intlLocale, t } from '../i18n/index.js';

interface ModelPrice {
  model_name: string;
  provider: string;
  display_name: string | null;
  input_price_per_million: number | null;
  output_price_per_million: number | null;
}

interface ModelPricesData {
  models: ModelPrice[];
  lastSyncedAt: string | null;
}

type SortKey =
  | 'display_name'
  | 'model_name'
  | 'provider'
  | 'input_price_per_million'
  | 'output_price_per_million';
type SortDir = 'asc' | 'desc';

function formatPrice(price: number | null): string {
  if (price == null) return '—';
  if (price < 0.01) return usd(price, 4);
  if (price < 1) return usd(price, 3);
  return usd(price, 2);
}

const rawDisplayName = (m: ModelPrice) => m.display_name || getModelDisplayName(m.model_name);
const resolveDisplayName = (m: ModelPrice) => rawDisplayName(m).replace(/\s*\(free\)/i, '');

function formatSyncTime(ts: string | null): string {
  if (!ts) return t('models.prices.never');
  return new Date(ts).toLocaleString(intlLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const sortedUnique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export default function ModelPrices() {
  preloadModelDisplayNames();
  const { data, error, loading, reload } = useResource(
    () => getModelPrices() as Promise<ModelPricesData>,
    [],
  );
  const [sortKey, setSortKey] = useState<SortKey>('provider');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set());
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(() => new Set());

  const models = data?.models;
  const allProviders = useMemo(() => sortedUnique((models ?? []).map((m) => m.provider)), [models]);
  const allModelNames = useMemo(
    () => sortedUnique((models ?? []).map((m) => m.model_name)),
    [models],
  );

  const filteredModels = useMemo(
    () =>
      (models ?? []).filter((m) => {
        if (selectedModels.size > 0 && !selectedModels.has(m.model_name)) return false;
        if (selectedProviders.size > 0 && !selectedProviders.has(m.provider)) return false;
        return true;
      }),
    [models, selectedModels, selectedProviders],
  );

  const sortedModels = useMemo(() => {
    if (!filteredModels.length) return [];
    return [...filteredModels].sort((a, b) => {
      if (sortKey === 'display_name') {
        const av = resolveDisplayName(a);
        const bv = resolveDisplayName(b);
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      // Sort nulls to the bottom regardless of sort direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filteredModels, sortKey, sortDir]);

  const pager = useClientPagination(sortedModels, 25);

  // Any change of filter or sort order starts again from the first page.
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    pager.resetPage();
  };

  const updateSet = (setter: typeof setSelectedModels, op: 'add' | 'delete') => (value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      next[op](value);
      return next;
    });
    pager.resetPage();
  };

  const clearFilters = () => {
    setSelectedModels(new Set());
    setSelectedProviders(new Set());
    pager.resetPage();
  };

  const columns: Array<{ key: SortKey; label: string; tooltip?: string; num?: boolean }> = [
    { key: 'display_name', label: t('models.prices.colModel') },
    { key: 'model_name', label: t('models.prices.colModelId') },
    { key: 'provider', label: t('models.prices.colProvider') },
    {
      key: 'input_price_per_million',
      label: t('models.prices.colSend'),
      tooltip: t('models.prices.sendTooltip'),
      num: true,
    },
    {
      key: 'output_price_per_million',
      label: t('models.prices.colReceive'),
      tooltip: t('models.prices.receiveTooltip'),
      num: true,
    },
  ];

  const ariaSort = (key: SortKey) =>
    sortKey !== key ? undefined : sortDir === 'asc' ? 'ascending' : 'descending';

  return (
    <div className="page wide">
      <title>{t('common.pageTitle', { page: t('models.prices.title') })}</title>
      <meta name="description" content={t('models.prices.metaDescription')} />
      <div className="page-head">
        <div>
          <h1>{t('models.prices.title')}</h1>
          <p className="sub">{t('models.prices.subtitle')}</p>
        </div>
        {data?.lastSyncedAt ? (
          <span className="text-xs text-muted">
            {t('models.prices.lastUpdated', { time: formatSyncTime(data.lastSyncedAt) })}
          </span>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="table-wrap">
          <div className="flex items-center justify-between gap-3 border-b border-line p-3">
            <Skel width={280} height={34} />
            <Skel width={80} />
          </div>
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? 'num' : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>
                  {['70%', '60%', '60%', '50%', '50%'].map((w, j) => (
                    <td key={j}>
                      <Skel width={w} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void reload()} />
      ) : (
        <div className="table-wrap">
          <ModelPricesFilterBar
            allModels={allModelNames}
            allProviders={allProviders}
            selectedModels={selectedModels}
            selectedProviders={selectedProviders}
            onAddModel={updateSet(setSelectedModels, 'add')}
            onRemoveModel={updateSet(setSelectedModels, 'delete')}
            onAddProvider={updateSet(setSelectedProviders, 'add')}
            onRemoveProvider={updateSet(setSelectedProviders, 'delete')}
            onClearFilters={clearFilters}
            totalCount={models?.length ?? 0}
            filteredCount={filteredModels.length}
          />
          {pager.totalItems > 0 ? (
            <>
              <table className="data">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={c.num ? 'sortable num' : 'sortable'}
                        aria-sort={ariaSort(c.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 uppercase [font:inherit] text-inherit hover:text-ink"
                            onClick={() => handleSort(c.key)}
                          >
                            {c.label}
                            {sortKey === c.key ? (
                              <span aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>
                            ) : null}
                          </button>
                          {c.tooltip ? <InfoTooltip text={c.tooltip} /> : null}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((model) => {
                    const isFree = /\(free\)/i.test(rawDisplayName(model));
                    const pid = resolveProviderId(model.provider);
                    return (
                      <tr key={`${model.provider}:${model.model_name}`}>
                        <td className="row-title">
                          {resolveDisplayName(model)}
                          {isFree ? (
                            <>
                              {' '}
                              <Badge tone="ok" className="free-tag">
                                {t('models.prices.free')}
                              </Badge>
                            </>
                          ) : null}
                        </td>
                        <td className="font-mono text-xs text-muted">{model.model_name}</td>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            {pid ? (
                              <span className="inline-flex shrink-0">{providerIcon(pid, 16)}</span>
                            ) : null}
                            {model.provider}
                          </span>
                        </td>
                        <td className="num">{formatPrice(model.input_price_per_million)}</td>
                        <td className="num">{formatPrice(model.output_price_per_million)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pager.totalItems > pager.pageSize ? (
                <div className="border-t border-line px-3 pb-3">
                  <Pagination
                    currentPage={pager.currentPage}
                    totalItems={pager.totalItems}
                    pageSize={pager.pageSize}
                    hasNextPage={pager.hasNextPage}
                    onPrevious={pager.previousPage}
                    onNext={pager.nextPage}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty">
              <h3>{t('models.prices.noMatchTitle')}</h3>
              <p className="max-w-md text-sm">{t('models.prices.noMatchHint')}</p>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t('models.prices.clearFilters')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
