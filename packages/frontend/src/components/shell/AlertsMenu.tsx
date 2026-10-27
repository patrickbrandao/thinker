import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Bell, CircleCheck } from 'lucide-react';
import { getAlerts, type AlertItem } from '../../services/api/console.js';
import { analyticsPing } from '../../services/sse.js';
import { formatRelativeTime } from '../../services/formatters.js';
import { useSignal } from '../../lib/signal.js';
import { useResource } from '../../lib/use-resource.js';
import { t } from '../../i18n/index.js';
import { cx, IconButton, Menu } from '../ui.jsx';

const SEEN_KEY = 'thinker.alertsSeenAt';
const POLL_MS = 60_000;

function readSeenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSeenAt(value: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(value));
  } catch {
    // Storage blocked: the badge resets on reload.
  }
}

/** Short label of a failure: HTTP status or class, then the message. */
function alertTitle(item: AlertItem): string {
  const status = item.errorHttpStatus ? `HTTP ${item.errorHttpStatus}` : null;
  return [status, item.errorClass].filter(Boolean).join(' · ') || item.status;
}

/**
 * The topbar bell: failed requests of the last 24 hours, newest first. The
 * badge counts the ones newer than the last time the list was opened (kept
 * per browser). Refreshes when new requests arrive and once a minute.
 */
export default function AlertsMenu() {
  const ping = useSignal(analyticsPing);
  const [tick, setTick] = useState(0);
  const [seenAt, setSeenAt] = useState(readSeenAt);
  const alerts = useResource(getAlerts, [ping, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const items = alerts.data?.items ?? [];
  const unseen = items.filter((i) => Date.parse(i.timestamp) > seenAt).length;

  const markSeen = () => {
    const now = Date.now();
    writeSeenAt(now);
    setSeenAt(now);
  };

  return (
    <Menu
      align="right"
      className="alerts"
      label={t('shell.alerts.title')}
      trigger={(props) => (
        <IconButton
          label={unseen > 0 ? t('shell.alerts.labelUnseen', unseen) : t('shell.alerts.title')}
          {...props}
          onClick={() => {
            props.onClick();
            void alerts.reload();
          }}
        >
          <Bell />
          {unseen > 0 ? <span className="dot">{unseen > 9 ? '9+' : unseen}</span> : null}
        </IconButton>
      )}
    >
      {() => (
        <>
          <div className="alerts-head">
            <strong className="text-[13px] text-ink">{t('shell.alerts.title')}</strong>
            {unseen > 0 ? (
              <button type="button" className="link-action text-xs" onClick={markSeen}>
                {t('shell.alerts.markSeen')}
              </button>
            ) : (
              <span className="text-xs text-faint">{t('shell.alerts.window')}</span>
            )}
          </div>
          <div className="alerts-list">
            {items.length === 0 ? (
              <div className="empty">
                <CircleCheck />
                <h3>{alerts.loading ? t('common.loading') : t('shell.alerts.empty')}</h3>
              </div>
            ) : (
              items.map((item) => (
                <Link
                  key={item.id}
                  to={`/messages?request=${encodeURIComponent(item.id)}`}
                  className={cx('alert-row', Date.parse(item.timestamp) > seenAt && 'is-unseen')}
                  data-menu-close
                >
                  <span className="alert-title">
                    <span className="truncate">{alertTitle(item)}</span>
                    <span className="shrink-0 text-xs font-normal text-faint">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </span>
                  <span className="block truncate text-muted">
                    {[item.agentName, item.model].filter(Boolean).join(' · ')}
                  </span>
                  {item.errorMessage ? (
                    <span className="mt-0.5 block line-clamp-2 text-dim">{item.errorMessage}</span>
                  ) : null}
                </Link>
              ))
            )}
          </div>
          <div className="alerts-foot">
            <Link to="/messages?status=failed" data-menu-close onClick={markSeen}>
              {alerts.data && alerts.data.total > items.length
                ? t('shell.alerts.viewAllCount', alerts.data.total)
                : t('shell.alerts.viewAll')}
            </Link>
          </div>
        </>
      )}
    </Menu>
  );
}
