import { useMemo, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import ErrorState from '../../components/ErrorState.js';
import { providerIcon } from '../../components/ProviderIcon.jsx';
import { Button, FloatingWindow, Skel } from '../../components/ui.js';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import { getProviderModels, type ProviderModelEntry } from '../../services/api/provider-models.js';
import { refreshConnectionModels } from '../../services/api/routing.js';
import { formatNumber } from '../../services/formatters.js';
import { toast } from '../../services/toast-store.js';
import {
  Capabilities,
  Details,
  ModelCell,
  ProviderCell,
  contextCell,
  priceCell,
} from './ProviderModels.jsx';

/** Every model one account (connection) offers, with this account's price. */
export default function ConnectionModels({
  connectionId,
  canRefresh,
  onRefreshed,
}: {
  connectionId: string;
  /** Custom providers list their models by hand; discovery skips them. */
  canRefresh: boolean;
  onRefreshed?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<ProviderModelEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = useResource(() => getProviderModels(true), [connectionId]);

  const models = useMemo(
    () =>
      (data.data?.models ?? [])
        .map((m) => ({
          ...m,
          accounts: m.accounts.filter((a) => a.connection_id === connectionId),
        }))
        .filter((m) => m.accounts.length > 0)
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [data.data, connectionId],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q),
        )
      : models;
  }, [models, search]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshConnectionModels();
      toast.success(t('providers.detail.modelsRefreshed'));
      await data.reload();
      onRefreshed?.();
    } catch {
      toast.error(t('providers.detail.refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="field w-full sm:w-64"
          placeholder={t('providers.models.search')}
          aria-label={t('providers.models.search')}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <span className="ml-auto text-xs text-muted">
          {t('providers.models.count', {
            shown: formatNumber(shown.length),
            total: formatNumber(models.length),
          })}
        </span>
        {canRefresh ? (
          <Button variant="ghost" size="sm" busy={refreshing} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" />
            {t('providers.detail.refreshModels')}
          </Button>
        ) : null}
      </div>

      {data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.reload()} />
      ) : data.loading && !data.data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skel key={i} height={36} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <Brain aria-hidden="true" />
          <p className="max-w-md text-sm">
            {models.length === 0 && canRefresh
              ? t('providers.detail.accountModelsEmpty')
              : t('providers.models.emptyTitle')}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data data-table">
            <thead>
              <tr>
                <th>{t('providers.models.col.model')}</th>
                <th>{t('providers.models.col.provider')}</th>
                <th className="text-right">{t('providers.models.col.price')}</th>
                <th className="text-right">{t('providers.models.col.context')}</th>
                <th>{t('providers.models.col.capabilities')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr
                  key={m.key}
                  className="msg-row--clickable cursor-pointer"
                  onClick={() => setOpen(m)}
                >
                  <td className="max-w-[320px]">
                    <ModelCell m={m} />
                  </td>
                  <td>
                    <ProviderCell m={m} />
                  </td>
                  <td className="whitespace-nowrap text-right">{priceCell(m.accounts[0]!)}</td>
                  <td className="text-right tabular-nums">{contextCell(m)}</td>
                  <td>
                    <Capabilities m={m} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FloatingWindow
        open={!!open}
        onClose={() => setOpen(null)}
        className="floating-window--wide floating-window--fit"
        title={open?.display_name ?? ''}
        icon={open && !open.provider.startsWith('custom:') ? providerIcon(open.provider, 16) : null}
      >
        {open ? <Details m={open} /> : null}
      </FloatingWindow>
    </div>
  );
}
