import { useState, type MouseEvent } from 'react';
import { EllipsisVertical, PanelRight, Plus, Star } from 'lucide-react';
import type { PlaygroundHistoryRunSummary } from '../../services/api.js';
import { togglePlaygroundRunStar } from '../../services/api.js';
import { Kbd, cx } from '../ui.jsx';
import { t } from '../../i18n/index.js';

interface Group {
  label: string;
  runs: PlaygroundHistoryRunSummary[];
}

/** Bucket runs into Today / Previous 7 Days / Older based on created_at. */
function groupRuns(runs: PlaygroundHistoryRunSummary[]): Group[] {
  const today: PlaygroundHistoryRunSummary[] = [];
  const week: PlaygroundHistoryRunSummary[] = [];
  const older: PlaygroundHistoryRunSummary[] = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = startOfToday - 7 * 86_400_000;
  for (const r of runs) {
    const ts = new Date(r.createdAt).getTime();
    if (ts >= startOfToday) today.push(r);
    else if (ts >= sevenDaysAgo) week.push(r);
    else older.push(r);
  }
  const out: Group[] = [];
  if (today.length > 0) out.push({ label: t('playground.history.today'), runs: today });
  if (week.length > 0) out.push({ label: t('playground.history.previous7'), runs: week });
  if (older.length > 0) out.push({ label: t('playground.history.older'), runs: older });
  return out;
}

interface Props {
  open: boolean;
  loading: boolean;
  runs: PlaygroundHistoryRunSummary[];
  activeRunId: string | null;
  onToggle: () => void;
  onSelect: (runId: string) => void;
  onStarToggle?: (runId: string, starred: boolean) => void;
  onNewPlayground?: () => void;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const isMac = () => typeof navigator !== 'undefined' && !!navigator.platform?.includes('Mac');

function RunItem({
  run,
  isActive,
  onSelect,
  onStarToggle,
}: {
  run: PlaygroundHistoryRunSummary;
  isActive: boolean;
  onSelect: () => void;
  onStarToggle?: (runId: string, starred: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [starred, setStarred] = useState(run.starred);

  const handleStar = async (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      const newVal = await togglePlaygroundRunStar(run.id);
      setStarred(newVal);
      onStarToggle?.(run.id, newVal);
    } catch {
      // silent
    }
  };

  return (
    <li
      className={cx(
        'playground-recent__item-wrapper group relative flex items-center rounded-control',
        isActive ? 'playground-recent__item--active bg-accent-tint' : 'hover:bg-s2',
      )}
    >
      <button
        type="button"
        className={cx(
          'playground-recent__item min-w-0 flex-1 truncate py-1.5 pl-2 pr-1 text-left text-[13px]',
          isActive ? 'text-accent' : 'text-dim',
        )}
        onClick={onSelect}
      >
        <span className="playground-recent__prompt">{truncate(run.prompt, 50)}</span>
      </button>
      <div className="relative shrink-0">
        <button
          type="button"
          className={cx(
            'playground-recent__more icon-btn h-7 w-7',
            !menuOpen && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-label={t('playground.history.options')}
        >
          <EllipsisVertical size={14} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <>
            <div
              className="playground-recent__menu-backdrop fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="playground-recent__menu menu right-0 top-full z-50 mt-1 min-w-36">
              <button
                type="button"
                className="playground-recent__menu-item menu-item"
                onClick={handleStar}
              >
                <Star size={14} fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />
                {starred ? t('playground.history.unstar') : t('playground.history.star')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </li>
  );
}

function RunGroup({
  label,
  runs,
  activeRunId,
  onSelect,
  onStarToggle,
}: {
  label: string;
  runs: PlaygroundHistoryRunSummary[];
  activeRunId: string | null;
  onSelect: (runId: string) => void;
  onStarToggle?: (runId: string, starred: boolean) => void;
}) {
  return (
    <section className="playground-recent__group mb-3">
      <h3 className="playground-recent__group-label eyebrow px-2 pb-1">{label}</h3>
      <ul className="playground-recent__list flex flex-col gap-px">
        {runs.map((run) => (
          <RunItem
            key={run.id}
            run={run}
            isActive={run.id === activeRunId}
            onSelect={() => onSelect(run.id)}
            onStarToggle={onStarToggle}
          />
        ))}
      </ul>
    </section>
  );
}

/** Playground run history, docked in the shell's right sidebar. */
export default function PlaygroundRecentSidebar({
  open,
  loading,
  runs,
  activeRunId,
  onToggle,
  onSelect,
  onStarToggle,
  onNewPlayground,
}: Props) {
  if (!open) {
    return (
      <div className="playground-recent--collapsed flex shrink-0 flex-col items-center border-l border-line bg-elev px-1.5 py-3">
        <button
          type="button"
          className="playground-recent__toggle icon-btn"
          onClick={onToggle}
          aria-label={t('playground.history.showRecent')}
          title={t('playground.history.showRecent')}
        >
          <PanelRight size={18} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const starredRuns = runs.filter((r) => r.starred);
  // Starred runs render in their own section, so exclude them from the date
  // groups — otherwise a starred run shows up twice.
  const timeGroups = groupRuns(runs.filter((r) => !r.starred));
  const mac = isMac();

  return (
    <aside
      className="playground-recent flex w-64 shrink-0 flex-col self-stretch border-l border-line bg-elev max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-[min(18rem,85vw)] max-md:shadow-[var(--shadow-float)] md:sticky md:top-0 md:h-full"
      aria-label={t('playground.history.runHistory')}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="playground-recent__title text-sm font-semibold text-ink">
          {t('playground.history.myRuns')}
        </h2>
        <button
          type="button"
          className="playground-recent__collapse icon-btn"
          onClick={onToggle}
          aria-label={t('playground.history.hideRuns')}
        >
          <PanelRight size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="px-2 pt-2">
        <button
          type="button"
          className="playground-recent__new flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-[13px] font-medium text-ink hover:bg-s2"
          onClick={() => onNewPlayground?.()}
        >
          <span className="flex items-center gap-2">
            <Plus size={14} aria-hidden="true" />
            <span className="playground-recent__new-label">{t('playground.history.newRun')}</span>
          </span>
          <span className="flex gap-0.5 max-md:hidden" aria-hidden="true">
            <Kbd>{mac ? '⇧' : 'Shift' /* i18n-ignore: key name */}</Kbd>
            <Kbd>{mac ? '⌘' : 'Ctrl' /* i18n-ignore: key name */}</Kbd>
            <Kbd>O</Kbd>
          </span>
        </button>
      </div>

      <div className="playground-recent__body flex-1 overflow-y-auto px-2 py-3">
        {!loading && runs.length === 0 ? (
          <p className="playground-recent__empty px-2 text-xs text-faint">
            {t('playground.history.empty')}
          </p>
        ) : null}
        {loading ? (
          <p className="playground-recent__empty px-2 text-xs text-faint">
            {t('playground.history.loading')}
          </p>
        ) : null}

        {starredRuns.length > 0 ? (
          <RunGroup
            label={t('playground.history.starred')}
            runs={starredRuns}
            activeRunId={activeRunId}
            onSelect={onSelect}
            onStarToggle={onStarToggle}
          />
        ) : null}

        {timeGroups.map((group) => (
          <RunGroup
            key={group.label}
            label={group.label}
            runs={group.runs}
            activeRunId={activeRunId}
            onSelect={onSelect}
            onStarToggle={onStarToggle}
          />
        ))}
      </div>
    </aside>
  );
}
