import { t } from '../i18n/index.js';
import CopyButton from './CopyButton.js';

/**
 * Shown when the browser blocks the sign-in window (embedded browsers block
 * every popup): the authorization URL to open or paste in any browser while
 * this view keeps waiting for the result.
 */
export default function AuthUrlFallback({ url }: { url: string }) {
  return (
    <div className="notice is-warn flex flex-col gap-2 text-sm" role="note">
      <span>{t('providerSetup.shared.popupBlockedOpenLink')}</span>
      <div className="flex w-full min-w-0 items-center gap-2">
        <a
          className="link-action min-w-0 flex-1 truncate font-mono text-xs"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url}
        </a>
        <CopyButton text={url} className="shrink-0" />
      </div>
    </div>
  );
}
