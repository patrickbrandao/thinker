import { For, Show, type Component } from 'solid-js';
import type { NotificationLog } from '../services/api.js';
import { intlLocale, t } from '../i18n/index.js';
import { usd } from '../services/formatters.js';

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

const LimitHistoryTable: Component<Props> = (props) => (
  <div class="panel">
    <div class="panel__title">{t('limits.history.title')}</div>
    <Show
      when={!props.loading}
      fallback={
        <table class="notif-table notif-table--flush">
          <thead>
            <tr>
              <th>{t('limits.history.date')}</th>
              <th>{t('limits.history.usage')}</th>
              <th>{t('limits.history.threshold')}</th>
              <th>{t('limits.history.resetsAt')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={[1, 2, 3]}>
              {() => (
                <tr>
                  <td>
                    <div class="skeleton skeleton--text" style="width: 100px;" />
                  </td>
                  <td>
                    <div class="skeleton skeleton--text" style="width: 60px;" />
                  </td>
                  <td>
                    <div class="skeleton skeleton--text" style="width: 60px;" />
                  </td>
                  <td>
                    <div class="skeleton skeleton--text" style="width: 100px;" />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      }
    >
      <Show
        when={(props.logs ?? []).length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-state__title">{t('limits.history.empty')}</div>
          </div>
        }
      >
        <table class="notif-table notif-table--flush">
          <thead>
            <tr>
              <th>{t('limits.history.date')}</th>
              <th>{t('limits.history.usage')}</th>
              <th>{t('limits.history.threshold')}</th>
              <th>{t('limits.history.resetsAt')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.logs}>
              {(log) => (
                <tr>
                  <td class="notif-table__mono">{formatDate(log.sent_at)}</td>
                  <td class="notif-table__mono">{formatValue(log, 'actual_value')}</td>
                  <td class="notif-table__mono">{formatValue(log, 'threshold_value')}</td>
                  <td class="notif-table__mono">{formatDate(log.period_end)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </Show>
  </div>
);

export default LimitHistoryTable;
