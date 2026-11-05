import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Boxes, List, RefreshCw, Rows3 } from 'lucide-react';
import type { ModelCapability } from 'thinker-shared';
import ErrorState from '../../components/ErrorState.js';
import ModelCapabilityBadges, {
  CAPABILITY_LABELS,
  ModelModalityBadges,
} from '../../components/ModelCapabilityBadges.js';
import { providerIcon } from '../../components/ProviderIcon.jsx';
import Select, { type SelectOption } from '../../components/Select.js';
import { Badge, Button, FloatingWindow, Skel } from '../../components/ui.js';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import {
  getProviderModels,
  type ModelAccountKind,
  type ProviderModelAccount,
  type ProviderModelEntry,
} from '../../services/api/provider-models.js';
import { refreshConnectionModels } from '../../services/api/routing.js';
import { formatDateTime, formatNumber, usd } from '../../services/formatters.js';
import { PROVIDERS } from '../../services/providers.js';
import { toast } from '../../services/toast-store.js';

/**
 * Providers → Models: every model the workspace's connections offer. Views
 * are a registry, so another one is a new entry in {@link VIEWS}.
 */

const perMillion = (perToken: number) => {
  const price = perToken * 1_000_000;
  return price < 0.01 ? usd(price, 4) : price < 1 ? usd(price, 3) : usd(price, 2);
};

const providerName = (m: Pick<ProviderModelEntry, 'provider' | 'provider_name'>) =>
  m.provider_name ?? PROVIDERS.find((p) => p.id === m.provider)?.name ?? m.provider;

const kindLabel = (kind: ModelAccountKind) =>
  t(`providers.models.kind.${kind}` as 'providers.models.kind.api_key');

/** "$x / $y" per million tokens, or Subscription / Local when there is no price. */
function priceCell(
  account: Pick<ProviderModelAccount, 'kind' | 'input_price_per_token' | 'output_price_per_token'>,
) {
  if (account.input_price_per_token == null && account.output_price_per_token == null) {
    return (
      <span className="text-muted">
        {account.kind === 'api_key' ? '—' : kindLabel(account.kind)}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {account.input_price_per_token != null ? perMillion(account.input_price_per_token) : '—'}
      {' / '}
      {account.output_price_per_token != null ? perMillion(account.output_price_per_token) : '—'}
    </span>
  );
}

/** Cheapest priced API-key account of a model, else its first account. */
function headlineAccount(m: ProviderModelEntry): ProviderModelAccount | undefined {
  const priced = m.accounts
    .filter((a) => a.input_price_per_token != null)
    .sort((a, b) => (a.input_price_per_token ?? 0) - (b.input_price_per_token ?? 0));
  return priced[0] ?? m.accounts[0];
}

function ProviderCell({ m }: { m: ProviderModelEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {m.provider.startsWith('custom:') ? null : providerIcon(m.provider, 14)}
      {providerName(m)}
    </span>
  );
}

function ModelCell({ m }: { m: ProviderModelEntry }) {
  return (
    <div className="min-w-0">
      <div className="row-title truncate">{m.display_name}</div>
      {m.display_name !== m.id ? <div className="row-sub mono truncate">{m.id}</div> : null}
    </div>
  );
}

const contextCell = (m: ProviderModelEntry) =>
  m.context_window ? formatNumber(m.context_window) : '—';

function Capabilities({ m }: { m: ProviderModelEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ModelCapabilityBadges capabilities={m.capabilities} iconOnly />
      {m.capability_reasoning ? <Badge>{t('providers.models.reasoning')}</Badge> : null}
    </div>
  );
}

interface ViewProps {
  models: ProviderModelEntry[];
  onOpen: (m: ProviderModelEntry) => void;
}

function ByModel({ models, onOpen }: ViewProps) {
  return (
    <table className="data data-table">
      <thead>
        <tr>
          <th>{t('providers.models.col.model')}</th>
          <th>{t('providers.models.col.provider')}</th>
          <th>{t('providers.models.col.accounts')}</th>
          <th className="text-right">{t('providers.models.col.price')}</th>
          <th className="text-right">{t('providers.models.col.context')}</th>
          <th>{t('providers.models.col.capabilities')}</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => {
          const head = headlineAccount(m);
          return (
            <tr key={m.key} className="msg-row--clickable cursor-pointer" onClick={() => onOpen(m)}>
              <td className="max-w-[320px]">
                <ModelCell m={m} />
              </td>
              <td>
                <ProviderCell m={m} />
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {m.accounts.map((a) => (
                    <Badge
                      key={a.connection_id}
                      tone={a.is_active ? undefined : 'outline'}
                      title={kindLabel(a.kind)}
                    >
                      {a.label}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="whitespace-nowrap text-right">{head ? priceCell(head) : '—'}</td>
              <td className="text-right tabular-nums">{contextCell(m)}</td>
              <td>
                <Capabilities m={m} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ByAccount({ models, onOpen }: ViewProps) {
  return (
    <table className="data data-table">
      <thead>
        <tr>
          <th>{t('providers.models.col.model')}</th>
          <th>{t('providers.models.col.provider')}</th>
          <th>{t('providers.models.col.account')}</th>
          <th>{t('providers.models.col.type')}</th>
          <th className="text-right">{t('providers.models.col.price')}</th>
          <th className="text-right">{t('providers.models.col.context')}</th>
        </tr>
      </thead>
      <tbody>
        {models.flatMap((m) =>
          m.accounts.map((a) => (
            <tr
              key={`${m.key}@${a.connection_id}`}
              className="msg-row--clickable cursor-pointer"
              onClick={() => onOpen(m)}
            >
              <td className="max-w-[320px]">
                <ModelCell m={m} />
              </td>
              <td>
                <ProviderCell m={m} />
              </td>
              <td>
                <Link
                  to={`/providers/connections/${encodeURIComponent(a.connection_id)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-ink"
                >
                  {a.label}
                </Link>
                {a.is_active ? null : (
                  <span className="ml-1.5 text-xs text-muted">{t('providers.inactive')}</span>
                )}
              </td>
              <td className="whitespace-nowrap">{kindLabel(a.kind)}</td>
              <td className="whitespace-nowrap text-right">{priceCell(a)}</td>
              <td className="text-right tabular-nums">{contextCell(m)}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

type ViewKey = 'model' | 'account';
const VIEWS: Record<
  ViewKey,
  { icon: ReactNode; label: () => string; render: (p: ViewProps) => ReactNode }
> = {
  model: {
    icon: <Rows3 size={14} aria-hidden="true" />,
    label: () => t('providers.models.viewByModel'),
    render: (p) => <ByModel {...p} />,
  },
  account: {
    icon: <List size={14} aria-hidden="true" />,
    label: () => t('providers.models.viewByAccount'),
    render: (p) => <ByAccount {...p} />,
  },
};

function Details({ m }: { m: ProviderModelEntry }) {
  const row = (k: string, v: ReactNode) => (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="m-0 text-ink">{v}</dd>
    </>
  );
  const lc = m.long_context_pricing;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {row(t('providers.models.col.provider'), <ProviderCell m={m} />)}
        {row(t('providers.models.detail.id'), <span className="mono">{m.id}</span>)}
        {row(t('providers.models.col.context'), contextCell(m))}
        {lc?.thresholdTokens
          ? row(
              t('providers.models.detail.longContext'),
              t('providers.models.detail.longContextValue', {
                tokens: formatNumber(lc.thresholdTokens),
                input: lc.inputPricePerToken != null ? perMillion(lc.inputPricePerToken) : '—',
                output: lc.outputPricePerToken != null ? perMillion(lc.outputPricePerToken) : '—',
              }),
            )
          : null}
        {row(
          t('providers.models.detail.input'),
          <ModelModalityBadges modalities={m.input_modalities} direction="input" compact />,
        )}
        {row(
          t('providers.models.detail.output'),
          <ModelModalityBadges modalities={m.output_modalities} direction="output" compact />,
        )}
        {row(t('providers.models.col.capabilities'), <Capabilities m={m} />)}
        {m.supported_endpoints.length
          ? row(
              t('providers.models.detail.endpoints'),
              <span className="mono text-xs">{m.supported_endpoints.join(', ')}</span>,
            )
          : null}
      </dl>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('providers.models.col.account')}</th>
              <th>{t('providers.models.col.type')}</th>
              <th className="text-right">{t('providers.models.col.price')}</th>
              <th>{t('providers.models.detail.discovered')}</th>
            </tr>
          </thead>
          <tbody>
            {m.accounts.map((a) => (
              <tr key={a.connection_id}>
                <td>
                  <Link to={`/providers/connections/${encodeURIComponent(a.connection_id)}`}>
                    {a.label}
                  </Link>
                </td>
                <td>{kindLabel(a.kind)}</td>
                <td className="whitespace-nowrap text-right">{priceCell(a)}</td>
                <td className="whitespace-nowrap text-xs text-muted">
                  {a.models_fetched_at ? formatDateTime(a.models_fetched_at) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint m-0">{t('providers.models.detail.priceHint')}</p>
    </div>
  );
}

export default function ProviderModels() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [view, setView] = useState<ViewKey>('model');
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState('');
  const [capability, setCapability] = useState('');
  const [open, setOpen] = useState<ProviderModelEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = useResource(() => getProviderModels(includeInactive), [includeInactive]);
  const models = data.data?.models ?? [];

  const providerOptions: SelectOption[] = useMemo(() => {
    const seen = new Map<string, ProviderModelEntry>();
    for (const m of models) if (!seen.has(m.provider)) seen.set(m.provider, m);
    return [
      { value: '', label: t('providers.models.allProviders') },
      ...[...seen.values()]
        .sort((a, b) => providerName(a).localeCompare(providerName(b)))
        .map((m) => ({ value: m.provider, label: providerName(m) })),
    ];
  }, [models]);
  const kindOptions: SelectOption[] = [
    { value: '', label: t('providers.models.allTypes') },
    ...(['api_key', 'subscription', 'local'] as const).map((k) => ({
      value: k,
      label: kindLabel(k),
    })),
  ];
  const capabilityOptions: SelectOption[] = [
    { value: '', label: t('providers.models.allCapabilities') },
    { value: 'reasoning', label: t('providers.models.reasoning') },
    ...(Object.keys(CAPABILITY_LABELS) as ModelCapability[]).map((c) => ({
      value: c,
      label: CAPABILITY_LABELS[c],
    })),
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models
      .map((m) => (kind ? { ...m, accounts: m.accounts.filter((a) => a.kind === kind) } : m))
      .filter((m) => m.accounts.length > 0)
      .filter((m) => !provider || m.provider === provider)
      .filter((m) =>
        !capability
          ? true
          : capability === 'reasoning'
            ? m.capability_reasoning
            : m.capabilities.includes(capability as ModelCapability),
      )
      .filter(
        (m) =>
          !q ||
          m.id.toLowerCase().includes(q) ||
          m.display_name.toLowerCase().includes(q) ||
          providerName(m).toLowerCase().includes(q),
      );
  }, [models, search, provider, kind, capability]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshConnectionModels();
      toast.success(t('providers.models.refreshed'));
      await data.reload();
    } catch {
      // error toast from fetchMutate
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="page full">
      <title>{t('common.pageTitle', { page: t('nav.models') })}</title>
      <div className="page-head">
        <p className="m-0 max-w-2xl text-sm text-muted">{t('providers.models.subtitle')}</p>
        <div className="page-actions">
          <Button variant="ghost" size="sm" busy={refreshing} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" />
            {t('providers.models.refresh')}
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="field w-full sm:w-64"
          placeholder={t('providers.models.search')}
          aria-label={t('providers.models.search')}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <div className="w-full sm:w-44">
          <Select value={provider} onChange={setProvider} options={providerOptions} />
        </div>
        <div className="w-full sm:w-40">
          <Select value={kind} onChange={setKind} options={kindOptions} />
        </div>
        <div className="w-full sm:w-44">
          <Select value={capability} onChange={setCapability} options={capabilityOptions} />
        </div>
        <label className="check text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.currentTarget.checked)}
          />
          {t('providers.models.includeInactive')}
        </label>
        <span className="ml-auto text-xs text-muted">
          {t('providers.models.count', {
            shown: formatNumber(filtered.length),
            total: formatNumber(models.length),
          })}
        </span>
        <div className="segmented" role="tablist">
          {(Object.keys(VIEWS) as ViewKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              aria-label={VIEWS[key].label()}
              title={VIEWS[key].label()}
              className="inline-flex items-center"
              onClick={() => setView(key)}
            >
              {VIEWS[key].icon}
            </button>
          ))}
        </div>
      </div>

      {data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.reload()} />
      ) : data.loading && !data.data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skel key={i} height={36} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <Boxes aria-hidden="true" />
          <h3>{t('providers.models.emptyTitle')}</h3>
          <p className="max-w-md text-sm">{t('providers.models.emptyBody')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          {VIEWS[view].render({ models: filtered, onOpen: setOpen })}
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
