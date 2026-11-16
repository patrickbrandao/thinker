/* Entry points into the live-session window ("Watch live", "Replay", "Open session"). */
import { History, Radio } from 'lucide-react';
import { Link } from 'react-router';
import { Button, cx } from '../ui.js';
import { t } from '../../i18n/index.js';
import { useLiveSessions } from './LiveSessionWindows.js';

/**
 * Blinking green dot of an active session, like a recording light. Green, not
 * red: an active session is good news, and red is kept for errors.
 */
export function LiveDot({ title }: { title?: string }) {
  return (
    <span
      className="relative inline-flex size-2 shrink-0"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
    >
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-70" />
      <span className="relative inline-flex size-2 rounded-full bg-ok" />
    </span>
  );
}

/** "Watch live" for an active session, "Replay" for a finished one. */
export function WatchLiveButton({
  sessionId,
  live,
  inFlight = false,
  size = 'sm',
  variant = 'ghost',
  className,
}: {
  sessionId: string;
  live: boolean;
  /** A request of the session is in progress (shown in the dot's tooltip). */
  inFlight?: boolean;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'primary';
  className?: string;
}) {
  const windows = useLiveSessions();
  if (!windows) return null;
  const open = windows.openSessionIds.includes(sessionId);
  return (
    <Button
      variant={variant}
      size={size === 'sm' ? 'sm' : undefined}
      className={cx('whitespace-nowrap', className)}
      aria-pressed={open || undefined}
      onClick={(e) => {
        e.stopPropagation();
        windows.openLiveSession(sessionId, { live });
      }}
    >
      {live ? (
        <LiveDot title={inFlight ? t('liveSession.entry.inFlight') : undefined} />
      ) : (
        <History size={13} />
      )}
      {open && live
        ? t('liveSession.entry.watching')
        : live
          ? t('liveSession.entry.watchLive')
          : t('liveSession.entry.replay')}
    </Button>
  );
}

/**
 * "Open session" from a request: the window opens positioned at that request.
 * Outside the dashboard shell (the stand-alone request page) it links to the
 * session page, which opens the window there.
 */
export function OpenSessionButton({
  sessionId,
  requestId,
  live,
}: {
  sessionId: string;
  requestId: string | null;
  live: boolean;
}) {
  const windows = useLiveSessions();
  if (!windows) {
    const q = new URLSearchParams({ watch: live ? 'live' : 'replay' });
    if (requestId) q.set('request', requestId);
    return (
      <Link
        className="link-action inline-flex items-center gap-1"
        to={`/sessions/${encodeURIComponent(sessionId)}?${q.toString()}`}
      >
        <Radio size={12} /> {t('liveSession.entry.openSession')}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="link-action inline-flex items-center gap-1"
      onClick={() =>
        windows.openLiveSession(sessionId, { live, requestId: requestId ?? undefined })
      }
    >
      <Radio size={12} /> {t('liveSession.entry.openSession')}
    </button>
  );
}
