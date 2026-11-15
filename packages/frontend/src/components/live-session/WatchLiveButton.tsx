/* Entry points into the live-session window ("Watch live", "Replay", "Open session"). */
import { History, Radio } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Button, cx } from '../ui.js';
import { t } from '../../i18n/index.js';
import { useLiveSessions } from './LiveSessionWindows.js';

/**
 * The "Active" pill of a session with a blinking green dot inside, like a
 * recording light. Green, not red: an active session is good news, and red
 * is kept for errors. The tooltip says when a request is in flight.
 */
export function ActiveBadge({ inFlight = false }: { inFlight?: boolean }) {
  return (
    <Badge tone="ok" title={inFlight ? t('liveSession.entry.inFlight') : undefined}>
      <span className="relative mr-1 inline-flex size-1.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-ok" />
      </span>
      {t('sessions.active')}
    </Badge>
  );
}

/** "Watch live" for an active session, "Replay" for a finished one. */
export function WatchLiveButton({
  sessionId,
  live,
  size = 'sm',
  variant = 'ghost',
  className,
}: {
  sessionId: string;
  live: boolean;
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
      {live ? <Radio size={13} /> : <History size={13} />}
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
