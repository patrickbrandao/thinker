import type { ReactNode } from 'react';
import { authBadgeFor, authLabel } from './AuthBadge.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import InfoTooltip from './InfoTooltip.js';
import { Panel } from './ui.js';
import { customProviderColor, formatCost, formatNumber } from '../services/formatters.js';
import { getModelDisplayName } from '../services/model-display.js';
import {
  inferProviderFromModel,
  inferProviderName,
  resolveProviderId,
  stripCustomPrefix,
} from '../services/routing-utils.js';
import { PROVIDERS } from '../services/providers.js';
import { attemptSuccessRate, type ModelReliabilityRow } from '../services/api/analytics.js';
import { formatRate } from '../services/overview-format.js';
import { intlLocale, t } from '../i18n/index.js';

interface CostByModelRow {
  model: string;
  display_name?: string;
  tokens: number;
  share_pct: number;
  estimated_cost: number;
  auth_type: string | null;
  provider?: string | null;
  custom_provider_name?: string | null;
}

interface CostByModelTableProps {
  rows: CostByModelRow[];
  /** Per-model reliability (Total attempts · Success rate). The two columns
      render only when reliability data is provided. */
  reliability?: ModelReliabilityRow[];
}

function resolveRowProvider(row: CostByModelRow): string | undefined {
  if (row.provider) {
    const resolved = resolveProviderId(row.provider);
    if (resolved) return resolved;
  }
  if (row.model) return inferProviderFromModel(row.model);
  return undefined;
}

function resolveRowProviderName(row: CostByModelRow): string | undefined {
  const id = resolveRowProvider(row);
  if (!id) return undefined;
  return (
    PROVIDERS.find((p) => p.id === id)?.name ?? (row.model ? inferProviderName(row.model) : id)
  );
}

function RowIcon({ row }: { row: CostByModelRow }): ReactNode {
  const provId = resolveRowProvider(row);
  const isCustom = provId === 'custom' || provId?.startsWith('custom:') === true;
  if (row.model && isCustom) {
    const provName = row.custom_provider_name ?? undefined;
    const logo = customProviderLogo(provName ?? '', 16, undefined, row.model ?? undefined);
    if (logo) return logo;
    const letter = (provName ?? stripCustomPrefix(row.model)).charAt(0).toUpperCase();
    return (
      <span
        className="provider-card__logo-letter inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-on-accent"
        title={provName}
        // Custom providers get a generated color derived from their name.
        style={{ background: customProviderColor(provName ?? '') }}
      >
        {letter}
      </span>
    );
  }
  if (provId) {
    const provName = resolveRowProviderName(row);
    return (
      <span
        className="relative inline-flex size-3.5 shrink-0"
        title={`${provName ?? provId} (${authLabel(row.auth_type)})`}
      >
        {providerIcon(provId, 14)}
        {authBadgeFor(row.auth_type, 8)}
      </span>
    );
  }
  return null;
}

export default function CostByModelTable({ rows, reliability }: CostByModelTableProps) {
  const sortedRows = [...rows].sort((a, b) => b.estimated_cost - a.estimated_cost);
  const relFor = (model: string) => reliability?.find((r) => r.model === model);

  return (
    <Panel
      title={t('overview.modelUsage.title')}
      actions={<span className="panel-hint">{t('overview.modelUsage.subtitle')}</span>}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>{t('overview.modelUsage.model')}</th>
              <th>{t('overview.modelUsage.tokens')}</th>
              <th>{t('overview.modelUsage.pctOfTotal')}</th>
              <th>{t('overview.modelUsage.cost')}</th>
              {reliability ? (
                <>
                  <th>
                    <span className="inline-flex items-center gap-1">
                      {t('overview.totalAttempts')}
                      <InfoTooltip text={t('overview.tips.totalAttempts')} />
                    </span>
                  </th>
                  <th>
                    <span className="inline-flex items-center gap-1">
                      {t('overview.successRate')}
                      <InfoTooltip text={t('overview.tips.modelSuccessRate')} />
                    </span>
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => {
              const rel = reliability ? relFor(row.model) : undefined;
              const rate = rel ? attemptSuccessRate(rel) : null;
              return (
                <tr key={`${row.model}-${i}`}>
                  <td className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      <RowIcon row={row} />
                      {row.model
                        ? row.model.startsWith('custom:')
                          ? stripCustomPrefix(row.model)
                          : row.display_name || getModelDisplayName(row.model)
                        : row.model}
                    </span>
                  </td>
                  <td>{formatNumber(row.tokens)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-10 overflow-hidden rounded-sm bg-s3">
                        <div
                          className="h-full rounded-sm bg-accent"
                          style={{ width: `${row.share_pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted">{Math.round(row.share_pct)}%</span>
                    </div>
                  </td>
                  <td
                    title={
                      row.estimated_cost > 0 && row.estimated_cost < 0.01
                        ? new Intl.NumberFormat(intlLocale(), {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 6,
                          }).format(row.estimated_cost)
                        : undefined
                    }
                  >
                    {formatCost(row.estimated_cost) ?? '—'}
                  </td>
                  {reliability ? (
                    <>
                      <td>{rel ? formatNumber(rel.attempts) : '—'}</td>
                      <td>{rate == null ? '—' : formatRate(rate)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
