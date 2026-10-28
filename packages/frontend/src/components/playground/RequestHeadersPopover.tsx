import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../../services/use-focus-trap.js';
import {
  MAX_HEADER_ENTRIES,
  blankEntry,
  headerEntryIssues,
  type HeaderEntry,
  type HeaderIssue,
} from '../../services/playground-request-headers.js';
import { PlusIcon, TrashIcon, XIcon } from './icons.jsx';
import { Button, cx } from '../ui.jsx';
import { t } from '../../i18n/index.js';

interface Props {
  open: boolean;
  entries: HeaderEntry[];
  onChange: (entries: HeaderEntry[]) => void;
  onClose: () => void;
}

/** DOM id of a row's warning, referenced by the input's aria-describedby. */
export function headerWarningId(entryId: string): string {
  return `playground-header-warning-${entryId}`;
}

/** Warning shown under a row the server will drop. */
export function headerIssueMessage(name: string, issue: HeaderIssue): string {
  return t(`playground.headers.issue.${issue}`, { name, max: MAX_HEADER_ENTRIES });
}

const INPUT = 'playground-headers__input field h-8 min-w-0 font-mono text-xs';

/** Editor for the custom headers sent with every Playground provider call. */
export default function RequestHeadersPopover({ open, entries, onChange, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useFocusTrap(open, panelRef);

  // Screen-reader announcement for warnings that appear while typing. Only a
  // row whose issue *changes* to a new problem is announced, so typing more
  // characters into an already-invalid name doesn't repeat the message. The
  // first pass (opening with existing rows) is silent: the warning is still
  // reachable through each input's aria-describedby.
  const [announcement, setAnnouncement] = useState('');
  const issues = useMemo(() => headerEntryIssues(entries), [entries]);
  const previousIssues = useRef<Map<string, HeaderIssue | null> | undefined>(undefined);
  useEffect(() => {
    // Closed: forget the last message so reopening doesn't replay a stale one.
    if (!open) {
      setAnnouncement('');
      previousIssues.current = undefined;
      return;
    }
    const next = new Map<string, HeaderIssue | null>();
    let message = '';
    let anyIssue = false;
    for (const e of entries) {
      const issue = issues.get(e.id) ?? null;
      next.set(e.id, issue);
      if (!issue) continue;
      anyIssue = true;
      const prev = previousIssues.current;
      if (prev && !message && prev.get(e.id) !== issue) {
        message = headerIssueMessage(e.key.trim(), issue);
      }
    }
    if (message) setAnnouncement(message);
    else if (!anyIssue) setAnnouncement('');
    previousIssues.current = next;
  }, [open, entries, issues]);

  if (!open) return null;

  const update = (id: string, patch: Partial<HeaderEntry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const remove = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
  };
  const add = () => {
    onChange([...entries, blankEntry()]);
  };
  const clearAll = () => onChange([]);

  return (
    <>
      <div
        className="playground-headers__backdrop fixed inset-0 z-40"
        role="presentation"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="playground-headers absolute bottom-full left-0 z-50 mb-2 flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-3 rounded-surface border border-line bg-elev p-4 shadow-[var(--shadow-float)]"
        role="dialog"
        aria-modal="true"
        aria-label={t('playground.headers.title')}
      >
        <header className="flex items-center justify-between gap-2">
          <h3 className="playground-headers__title text-sm font-semibold text-ink">
            {t('playground.headers.title')}
          </h3>
          <button
            type="button"
            className="playground-headers__close icon-btn h-7 w-7"
            aria-label={t('playground.headers.close')}
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </header>

        <p className="playground-headers__hint hint mt-0">{t('playground.headers.hint')}</p>

        {entries.length === 0 ? (
          <p className="playground-headers__empty text-xs text-faint">
            {t('playground.headers.empty')}
          </p>
        ) : null}

        <div className="playground-headers__rows flex max-h-72 flex-col gap-2 overflow-y-auto">
          {entries.map((entry) => {
            const issue = issues.get(entry.id) ?? null;
            const valueIssue = issue === 'control-chars' || issue === 'unsupported-chars';
            const nameIssue = issue !== null && !valueIssue;
            const warningId = headerWarningId(entry.id);
            return (
              <div
                key={entry.id}
                className={cx(
                  'playground-headers__row grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2',
                  issue === 'blocked' && 'playground-headers__row--blocked',
                  (issue === 'invalid-name' || issue === 'duplicate' || issue === 'over-limit') &&
                    'playground-headers__row--invalid-name',
                  valueIssue && 'playground-headers__row--invalid-value',
                )}
              >
                <input
                  type="text"
                  className={cx(INPUT, 'playground-headers__input--key')}
                  placeholder={t('playground.headers.namePlaceholder')}
                  value={entry.key}
                  aria-label={t('playground.headers.nameLabel')}
                  aria-invalid={nameIssue ? 'true' : undefined}
                  aria-describedby={nameIssue ? warningId : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update(entry.id, { key: e.currentTarget.value })}
                />
                <input
                  type="text"
                  className={cx(INPUT, 'playground-headers__input--value')}
                  placeholder={t('playground.headers.valuePlaceholder')}
                  value={entry.value}
                  aria-label={t('playground.headers.valueLabel')}
                  aria-invalid={valueIssue ? 'true' : undefined}
                  aria-describedby={valueIssue ? warningId : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update(entry.id, { value: e.currentTarget.value })}
                />
                <button
                  type="button"
                  className="playground-headers__remove icon-btn h-8 w-8 hover:text-danger"
                  aria-label={t('playground.headers.remove', {
                    name: entry.key || t('playground.headers.headerFallback'),
                  })}
                  onClick={() => remove(entry.id)}
                >
                  <TrashIcon size={14} />
                </button>
                {issue ? (
                  <p
                    id={warningId}
                    className={cx(
                      'playground-headers__warning col-span-3 text-xs',
                      issue === 'blocked' ? 'text-warn' : 'text-danger',
                    )}
                  >
                    {headerIssueMessage(entry.key.trim(), issue)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        <footer className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="playground-headers__add" onClick={add}>
            <PlusIcon size={14} /> {t('playground.headers.add')}
          </Button>
          {entries.length > 0 ? (
            <Button
              variant="quiet"
              size="sm"
              className="playground-headers__clear"
              onClick={clearAll}
            >
              {t('playground.headers.clearAll')}
            </Button>
          ) : null}
        </footer>
      </div>
    </>
  );
}
