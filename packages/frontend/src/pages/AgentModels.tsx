import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  getHarnessModelList,
  type HarnessModelEntry,
  type HarnessModelList,
} from '../services/api/virtual-models.js';
import { PROVIDERS } from '../services/providers.js';
import { pricePerM } from '../services/routing-utils.js';
import { formatNumber } from '../services/formatters.js';
import { agentPath } from '../services/routing.js';
import { agentDisplayName, agentDisplayNameSignal } from '../services/agent-display-name.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { useSignal } from '../lib/signal.js';
import { t, tMaybe } from '../i18n/index.js';
import { Badge, Skel } from '../components/ui.js';

const EMPTY: HarnessModelList = { listing: 'open', data: [] };

function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

function kindBadge(kind: HarnessModelEntry['kind']) {
  if (kind === 'auto') return <Badge tone="accent">{t('harnesses.modelsTab.kindAuto')}</Badge>;
  if (kind === 'virtual') return <Badge tone="info">{t('harnesses.modelsTab.kindVirtual')}</Badge>;
  return <Badge>{t('harnesses.modelsTab.kindModel')}</Badge>;
}

function details(m: HarnessModelEntry): string {
  if (m.kind === 'auto') return t('harnesses.modelsTab.autoDetails');
  const parts: string[] = [];
  if (m.kind === 'virtual') {
    parts.push(
      m.primary
        ? t('harnesses.modelsTab.primary', { model: m.primary.model })
        : t('harnesses.modelsTab.noPrimary'),
    );
    const n = m.fallbacks?.length ?? 0;
    if (n > 0) {
      parts.push(
        n === 1 ? t('harnesses.modelsTab.fallbacksOne') : t('harnesses.modelsTab.fallbacks', { n }),
      );
    }
    if (m.continue_on_default) parts.push(t('harnesses.modelsTab.continueOnDefault'));
    if (m.response_mode === 'stream') parts.push(t('harnesses.modelsTab.stream'));
    return parts.join(' · ');
  }
  if (m.reasoning) parts.push(t('harnesses.modelsTab.reasoning'));
  if (m.code) parts.push(t('harnesses.modelsTab.code'));
  const inputs = (m.input_modalities ?? []).filter((x) => x !== 'text');
  if (inputs.length > 0) parts.push(inputs.join(', '));
  return parts.join(' · ');
}

/**
 * Models tab of a harness: every id its `GET /v1/models` lists (`auto`, the
 * virtual models, then the real models the listing mode keeps), in a table.
 */
export default function AgentModels() {
  useSignal(agentDisplayNameSignal);
  const params = useParams<{ agentName: string }>();
  const agentName = decodeURIComponent(params.agentName ?? '');
  const name = agentDisplayName() ?? agentName;
  const [filter, setFilter] = useState('');

  const list = useResource(
    () =>
      getHarnessModelList(agentName).catch((err) => {
        toast.error(err instanceof Error ? err.message : t('harnesses.modelsTab.loadFailed'));
        return EMPTY;
      }),
    [agentName],
  );
  const all = list.data?.data ?? [];
  const query = filter.trim().toLowerCase();
  const rows = query
    ? all.filter((m) =>
        [m.id, m.display_name ?? '', providerName(m.owned_by)].some((v) =>
          v.toLowerCase().includes(query),
        ),
      )
    : all;
  const mode = list.data?.listing ?? 'open';

  return (
    <div className="agent-models">
      <title>{t('common.pageTitle', { page: t('harnesses.modelsTab.title', { name }) })}</title>
      <p className="mb-2 text-sm text-muted">{t('harnesses.modelsTab.intro')}</p>
      <p className="mb-4 text-sm text-muted">
        {t('harnesses.modelsTab.listing', {
          mode: tMaybe(`harnesses.modelListing.${mode}`) ?? mode,
        })}{' '}
        <Link className="text-accent hover:underline" to={agentPath(agentName, '/settings')}>
          {t('harnesses.modelsTab.changeListing')}
        </Link>
      </p>

      <div className="mb-3 flex items-center gap-3">
        <input
          type="search"
          className="field agent-models__filter max-w-xs"
          placeholder={t('harnesses.modelsTab.search')}
          aria-label={t('harnesses.modelsTab.search')}
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        <span className="agent-models__count text-xs text-muted">
          {all.length === 1
            ? t('harnesses.modelsTab.countOne')
            : t('harnesses.modelsTab.count', { n: all.length })}
        </span>
      </div>

      {list.loading && !list.data ? (
        <Skel width="100%" height={160} />
      ) : (
        <div className="table-wrap">
          <table className="data min-w-[900px]">
            <thead>
              <tr>
                <th>{t('harnesses.modelsTab.colModel')}</th>
                <th>{t('harnesses.modelsTab.colType')}</th>
                <th>{t('harnesses.modelsTab.colProvider')}</th>
                <th className="num">{t('harnesses.modelsTab.colContext')}</th>
                <th className="num">{t('harnesses.modelsTab.colInput')}</th>
                <th className="num">{t('harnesses.modelsTab.colOutput')}</th>
                <th>{t('harnesses.modelsTab.colDetails')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const routed = m.kind !== 'model';
                return (
                  <tr key={m.id} className="agent-models__row" data-kind={m.kind}>
                    <td>
                      <span className="row-title block font-mono text-xs">{m.id}</span>
                      {m.display_name && m.display_name !== m.provider_model_id ? (
                        <span className="block truncate text-xs text-muted">{m.display_name}</span>
                      ) : null}
                    </td>
                    <td>{kindBadge(m.kind)}</td>
                    <td>
                      <span className="block">{routed ? 'Thinker' : providerName(m.owned_by)}</span>
                      {m.auth_type ? (
                        <span className="block text-xs text-muted">
                          {tMaybe(`providers.authBadge.${m.auth_type}`) ?? m.auth_type}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">
                      {m.context_length ? formatNumber(m.context_length) : '—'}
                    </td>
                    <td className="num">
                      {routed
                        ? t('harnesses.modelsTab.varies')
                        : pricePerM(m.input_price_per_token)}
                    </td>
                    <td className="num">
                      {routed
                        ? t('harnesses.modelsTab.varies')
                        : pricePerM(m.output_price_per_token)}
                    </td>
                    <td className="text-xs text-muted">{details(m)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && all.length > 0 ? (
            <p className="p-4 text-sm text-muted">{t('harnesses.modelsTab.empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
