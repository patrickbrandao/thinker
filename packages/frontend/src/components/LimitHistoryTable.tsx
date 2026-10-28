import type { NotificationLog } from '../services/api.js';
import { intlLocale, t } from '../i18n/index.js';
import { usd } from '../services/formatters.js';
import { EmptyState, Panel, Skel } from './ui.js';

function formatValue(log: NotificationLog, field: 'actual_value' | 'threshold_value'): string {
  const val = Number(log[field]);
  if (log.metric_type === 'cost') return usd(val, 2);
  return t('limits.tokensValue', { value: val.toLocaleString(intlLocale()) });
}

function formatDate(dateStr: string): string {
  const normalized = dateStr.endsWith('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return d.toLocaleDateString(intlLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  logs: NotificationLog[] | undefined;
  loading: boolean;
}

function Head() {
  return (
    <thead>
      <tr>
        <th>{t('limits.history.date')}</th>
        <th>{t('limits.history.usage')}</th>
        <th>{t('limits.history.threshold')}</th>
        <th>{t('limits.history.resetsAt')}</th>
      </tr>
    </thead>
  );
}

export default function LimitHistoryTable({ logs, loading }: Props) {
  const list = logs ?? [];
  return (
    <Panel title={t('limits.history.title')} bodyClassName="p-0">
      {loading ? (
        <div className="overflow-x-auto">
          <table className="data">
            <Head />
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  <td>
                    <Skel width={100} height={12} />
                  </td>
                  <td>
                    <Skel width={60} height={12} />
                  </td>
                  <td>
                    <Skel width={60} height={12} />
                  </td>
                  <td>
                    <Skel width={100} height={12} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : list.length === 0 ? (
        <EmptyState title={t('limits.history.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="data">
            <Head />
            <tbody>
              {list.map((log) => (
                <tr key={log.id}>
                  <td className="font-mono">{formatDate(log.sent_at)}</td>
                  <td className="font-mono">{formatValue(log, 'actual_value')}</td>
                  <td className="font-mono">{formatValue(log, 'threshold_value')}</td>
                  <td className="font-mono">{formatDate(log.period_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
