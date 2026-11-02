import { useEffect, useState } from 'react';
import { getOpencodeGoUsage, type OpencodeGoUsage } from '../services/api/oauth.js';
import { formatDateTime } from '../services/formatters.js';
import { t } from '../i18n/index.js';

const WINDOWS = ['rolling', 'weekly', 'monthly'] as const;

/**
 * OpenCode Go allowance: the share spent in its 5-hour, weekly and monthly
 * windows. Read once when the provider page opens; hidden when the
 * connection cannot read it (a pasted API key, or no Go on the workspace).
 */
export default function OpencodeGoUsageMeter({ agentName }: { agentName: string }) {
  const [usage, setUsage] = useState<OpencodeGoUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOpencodeGoUsage(agentName)
      .then((result) => {
        if (!cancelled) setUsage(result.usage);
      })
      .catch(() => {
        // The meter is informational; a failed read just hides it.
      });
    return () => {
      cancelled = true;
    };
  }, [agentName]);

  if (!usage || WINDOWS.every((key) => !usage[key])) return null;

  return (
    <section className="mb-4" aria-label={t('providerSetup.goUsage.title')}>
      <p className="label provider-detail__label">{t('providerSetup.goUsage.title')}</p>
      <ul className="flex flex-col gap-2">
        {WINDOWS.map((key) => {
          const window = usage[key];
          if (!window) return null;
          const percent = Math.max(0, Math.min(100, Math.round(window.percent)));
          return (
            <li key={key} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>{t(`providerSetup.goUsage.${key}`)}</span>
                <span className={window.limited ? 'text-danger' : 'text-dim'}>
                  {window.limited ? t('providerSetup.goUsage.limited') : `${percent}%`}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={t(`providerSetup.goUsage.${key}`)}
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-s3"
              >
                <div
                  className={window.limited ? 'h-full bg-danger' : 'h-full bg-accent'}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {window.resetsAt ? (
                <p className="hint">
                  {t('providerSetup.goUsage.resetsAt', { time: formatDateTime(window.resetsAt) })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
