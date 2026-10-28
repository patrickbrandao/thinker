import type { MouseEvent } from 'react';
import { MoreVertical, TriangleAlert } from 'lucide-react';
import AlertIcon from './AlertIcon.js';
import LimitIcon from './LimitIcon.js';
import { EmptyState, IconButton, Panel, Skel, cx } from './ui.js';
import type { NotificationRule } from '../services/api.js';
import { intlLocale, t, tMaybe } from '../i18n/index.js';
import { usd } from '../services/formatters.js';

function formatThreshold(rule: NotificationRule): string {
  if (rule.metric_type === 'cost') return usd(Number(rule.threshold), 2);
  return t('limits.tokensValue', { value: Number(rule.threshold).toLocaleString(intlLocale()) });
}

/** Localized period label ("Per day"), or undefined for an unknown period. */
function periodLabel(period: string): string | undefined {
  return tMaybe(`limits.period.${period}`);
}

interface LimitRuleTableProps {
  rules: NotificationRule[] | undefined;
  loading: boolean;
  hasProvider: boolean;
  onToggleMenu: (ruleId: string, e: MouseEvent<HTMLButtonElement>) => void;
}

const hasEmailAction = (action: string) => action === 'notify' || action === 'both';
const hasBlockAction = (action: string) => action === 'block' || action === 'both';

function Head() {
  return (
    <thead>
      <tr>
        <th>{t('limits.table.type')}</th>
        <th>{t('limits.table.threshold')}</th>
        <th className="num">{t('limits.table.triggered')}</th>
        <th className="text-right">{t('limits.table.actions')}</th>
      </tr>
    </thead>
  );
}

export default function LimitRuleTable({
  rules,
  loading,
  hasProvider,
  onToggleMenu,
}: LimitRuleTableProps) {
  const list = rules ?? [];
  return (
    <Panel title={t('limits.table.title')} bodyClassName="p-0">
      {loading ? (
        <div className="overflow-x-auto">
          <table className="data">
            <Head />
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  <td>
                    <Skel width={28} height={12} />
                  </td>
                  <td>
                    <Skel width={80} height={12} />
                  </td>
                  <td className="num">
                    <Skel width={20} height={12} />
                  </td>
                  <td className="text-right">
                    <Skel width={16} height={12} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title={t('limits.table.emptyTitle')}
          description={t('limits.table.emptyBody')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data">
            <Head />
            <tbody>
              {list.map((rule) => {
                const action = rule.action ?? 'notify';
                return (
                  <tr key={rule.id} className={cx(!rule.is_active && 'is-off')}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        {hasEmailAction(action) ? (
                          <span
                            className="limit-type-icon inline-flex text-muted"
                            title={t('limits.table.emailAlert')}
                          >
                            <AlertIcon size={14} />
                          </span>
                        ) : null}
                        {hasBlockAction(action) ? (
                          <span
                            className="limit-type-icon inline-flex text-muted"
                            title={t('limits.table.hardLimit')}
                          >
                            <LimitIcon size={14} />
                          </span>
                        ) : null}
                        {hasEmailAction(action) && !hasProvider ? (
                          <span className="badge is-warn">
                            <TriangleAlert className="size-3" aria-hidden="true" />
                            {t('limits.table.noProvider')}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-ink">{formatThreshold(rule)}</span>{' '}
                      <span className="text-muted">
                        {(periodLabel(rule.period) ?? rule.period).toLowerCase()}
                      </span>
                    </td>
                    <td className="num">{rule.trigger_count ?? 0}</td>
                    <td>
                      <div className="row-actions">
                        <IconButton
                          label={t('limits.table.ruleOptions')}
                          onClick={(e) => onToggleMenu(rule.id, e)}
                        >
                          <MoreVertical aria-hidden="true" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export { formatThreshold, periodLabel };
