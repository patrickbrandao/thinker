/* Views of a live session: Chat, Details, Inspector, Compact and the per-attempt timeline. */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Bot,
  Brain,
  ChevronRight,
  CircleUser,
  ExternalLink,
  OctagonX,
  ScrollText,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import {
  liveProviderFrames,
  type LiveAttempt,
  type LiveBlock,
  type LiveItem,
  type LiveMessage,
  type LiveState,
} from 'thinker-shared';
import { MarkdownContent } from '../RequestMessages.js';
import { cx } from '../ui.js';
import { intlLocale, t } from '../../i18n/index.js';
import { usd } from '../../services/formatters.js';

// ------------------------------------------------------------------ clock

/** null = live (wall clock); a number = the server time of a replay position. */
export const ReplayClock = createContext<number | null>(null);

/** Current time for elapsed timers; ticks only while live and `running`. */
function useNow(running: boolean): number {
  const fixed = useContext(ReplayClock);
  const [, setN] = useState(0);
  useEffect(() => {
    if (fixed != null || !running) return;
    const id = setInterval(() => setN((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [fixed, running]);
  return fixed ?? Date.now();
}

// ------------------------------------------------------------- formatting

export const fmtInt = (n: number) => new Intl.NumberFormat(intlLocale()).format(n);
export const fmtUsd = (n: number) => (n === 0 ? usd(0, 0) : usd(n, 4));
export const fmtSecs = (ms: number) =>
  t('liveSession.secs', {
    n: new Intl.NumberFormat(intlLocale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Math.max(0, ms) / 1000),
  });

function prettyJson(text: string, done: boolean): string {
  if (!done) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Tool results by call id: they render inside their tool card. */
export function useToolResults(state: LiveState) {
  return useMemo(() => {
    const m = new Map<string, LiveMessage>();
    for (const it of state.items)
      if (it.kind === 'message' && it.role === 'tool' && it.toolCallId) m.set(it.toolCallId, it);
    return m;
    // The state is mutated in place: the event id is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.items, state.items.length, state.lastEventId]);
}

const toolSummary = (b: LiveBlock) => {
  try {
    const v = JSON.parse(b.text) as Record<string, unknown>;
    const first = Object.values(v)[0];
    return Array.isArray(first) ? first.join(' ') : String(first ?? '');
  } catch {
    return b.text.slice(0, 60);
  }
};

/** Blocks may have holes (an index whose block.started never arrived). */
const blocksOf = (a: LiveAttempt) => a.blocks.filter(Boolean);

// ------------------------------------------------------------------ parts

export const Caret = () => (
  <span className="ml-0.5 inline-block h-[1em] w-[7px] translate-y-[2px] animate-pulse bg-accent align-baseline" />
);

const THINK_BORDER =
  'border-[color-mix(in_srgb,var(--port-2)_35%,transparent)] bg-[color-mix(in_srgb,var(--port-2)_6%,transparent)]';

function Collapsible({
  icon,
  title,
  meta,
  defaultOpen,
  tone,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen: boolean;
  tone?: 'warn' | 'danger' | 'muted' | 'think';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Follows the default until the user clicks (thinking collapses when it ends).
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen(defaultOpen);
  }, [defaultOpen]);
  return (
    <div
      className={cx(
        'rounded-md border text-[13px]',
        tone === 'think' && THINK_BORDER,
        tone === 'warn' && 'border-warn/30 bg-warn-tint/40',
        tone === 'danger' && 'border-danger/30 bg-danger-tint',
        (!tone || tone === 'muted') && 'border-line bg-s2',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => {
          touched.current = true;
          setOpen((o) => !o);
        }}
      >
        <ChevronRight
          size={14}
          className={cx('shrink-0 text-muted transition-transform', open && 'rotate-90')}
        />
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{title}</span>
        {meta && <span className="shrink-0 text-[11px] text-muted">{meta}</span>}
      </button>
      {open && <div className="border-t border-inherit px-3 py-2">{children}</div>}
    </div>
  );
}

function ThinkingBlock({ b, autoCollapse }: { b: LiveBlock; autoCollapse: boolean }) {
  const now = useNow(!b.done);
  const secs = fmtSecs((b.endedTs ?? now) - b.startedTs);
  return (
    <Collapsible
      tone="think"
      icon={<Brain size={14} className="shrink-0 text-[var(--port-2)]" />}
      title={
        b.done ? (
          t('liveSession.thinking.thoughtFor', { secs })
        ) : b.endedTs ? (
          t('liveSession.thinking.stoppedAfter', { secs })
        ) : (
          <span className="animate-pulse">{t('liveSession.thinking.live', { secs })}</span>
        )
      }
      meta={t('liveSession.chars', { n: fmtInt(b.text.length) })}
      defaultOpen={!b.done || !autoCollapse}
    >
      <div className="whitespace-pre-wrap italic leading-relaxed text-dim">
        {b.redacted && !b.text ? t('liveSession.thinking.encrypted') : b.text}
        {!b.done && !b.endedTs && <Caret />}
      </div>
    </Collapsible>
  );
}

function ToolUseBlock({ b, result }: { b: LiveBlock; result?: LiveMessage }) {
  const state = !b.done
    ? t('liveSession.tool.streamingArgs')
    : result
      ? result.isError
        ? t('liveSession.tool.error')
        : t('liveSession.tool.result')
      : t('liveSession.tool.running');
  return (
    <Collapsible
      tone="warn"
      icon={<Wrench size={14} className="shrink-0 text-warn" />}
      title={
        <>
          <span className="font-mono">{b.name}</span>
          <span className="ml-2 font-mono text-[11px] text-muted">{b.toolCallId}</span>
        </>
      }
      meta={<span className={cx(!result && b.done && 'animate-pulse')}>{state}</span>}
      defaultOpen
    >
      <pre className="m-0 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] text-dim">
        {prettyJson(b.text, b.done)}
        {!b.done && <Caret />}
      </pre>
      {result && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            {t('liveSession.tool.resultTitle')}
          </div>
          <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] text-dim">
            {result.text}
          </pre>
        </div>
      )}
    </Collapsible>
  );
}

function TextBlock({ b, size = 14 }: { b: LiveBlock; size?: number }) {
  return (
    <div className="leading-relaxed text-ink" style={{ fontSize: size }}>
      <MarkdownContent text={b.text} />
      {!b.done && !b.endedTs && <Caret />}
    </div>
  );
}

// --------------------------------------------------------- request timeline

const SEG_COLOR = {
  wait: 'bg-s4',
  thinking: 'bg-[var(--port-2)]',
  text: 'bg-accent',
  tool_use: 'bg-warn',
} as const;

/** One bar per attempt: time to first token, then each block in its color. */
export function RequestTimeline({ a }: { a: LiveAttempt }) {
  const now = useNow(!a.endedTs);
  const end = a.endedTs ?? now;
  const total = Math.max(1, end - a.startedTs);
  const blocks = blocksOf(a);
  const firstStart = blocks[0]?.startedTs ?? end;
  const segs: { kind: keyof typeof SEG_COLOR; from: number; to: number; label: string }[] = [
    {
      kind: 'wait',
      from: a.startedTs,
      to: firstStart,
      label: blocks.length
        ? t('liveSession.timeline.ttft')
        : a.status === 'failed'
          ? t('liveSession.timeline.untilError')
          : t('liveSession.timeline.waiting'),
    },
  ];
  for (const b of blocks)
    segs.push({
      kind: b.type,
      from: b.startedTs,
      to: b.endedTs ?? (b.done ? b.startedTs : end),
      label:
        b.type === 'tool_use'
          ? t('liveSession.timeline.args', { name: b.name ?? '' })
          : b.type === 'thinking'
            ? t('liveSession.timeline.thinking')
            : t('liveSession.timeline.text'),
    });
  return (
    <div className="space-y-1">
      <div className="relative h-2 overflow-hidden rounded-full bg-s2">
        {segs.map((s, i) => (
          <div
            key={i}
            title={`${s.label}: ${fmtSecs(s.to - s.from)}`}
            className={cx(
              'absolute top-0 h-full',
              SEG_COLOR[s.kind],
              a.status === 'failed' && s.kind === 'wait' && 'bg-danger/60',
            )}
            style={{
              left: `${((s.from - a.startedTs) / total) * 100}%`,
              width: `${Math.max(0.5, ((s.to - s.from) / total) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
        {segs.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={cx('inline-block size-2 rounded-sm', SEG_COLOR[s.kind])} />
            {s.label} {fmtSecs(s.to - s.from)}
          </span>
        ))}
        <span>{t('liveSession.timeline.total', { secs: fmtSecs(total) })}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ details

export interface ViewOpts {
  showThinking: boolean;
  autoCollapse: boolean;
  showMeta: boolean;
}

function AttemptDetails({
  a,
  results,
  opts,
}: {
  a: LiveAttempt;
  results: Map<string, LiveMessage>;
  opts: ViewOpts;
}) {
  const now = useNow(a.status === 'waiting');
  const blocks = blocksOf(a);
  if (a.status === 'failed' && a.error && blocks.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-[13px]">
        <div className="flex items-start gap-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="font-medium text-ink">
              {a.provider} · <span className="font-mono">{a.model}</span>{' '}
              {t('liveSession.details.answered', { status: String(a.error.status ?? '—') })}
            </div>
            <div className="font-mono text-[12px] text-dim">{a.error.message}</div>
            <div className="text-[12px] text-muted">
              {a.error.next === 'fallback'
                ? t('liveSession.details.tryingNext')
                : t('liveSession.details.noRouteLeft')}
            </div>
          </div>
        </div>
        {opts.showMeta && <RequestTimeline a={a} />}
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ok-tint text-ok">
        <Bot size={15} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          <span className="font-medium text-ink">{t('liveSession.details.assistant')}</span>
          <span className="font-mono text-muted">{a.model}</span>
          <span className="text-faint">{t('liveSession.details.via')}</span>
          <span className="text-muted">{a.provider}</span>
          {a.attempt > 1 && (
            <span className="rounded bg-warn-tint px-1.5 text-[11px] text-warn">
              {t('liveSession.details.attempt', { n: a.attempt })}
            </span>
          )}
          {a.route ? <span className="text-faint">· {a.route}</span> : null}
        </div>
        {a.status === 'waiting' && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="size-2 animate-ping rounded-full bg-accent" />
            {t('liveSession.details.waitingFirstToken', { secs: fmtSecs(now - a.startedTs) })}
          </div>
        )}
        {blocks.map((b, i) =>
          b.type === 'thinking' ? (
            opts.showThinking ? (
              <ThinkingBlock key={i} b={b} autoCollapse={opts.autoCollapse} />
            ) : null
          ) : b.type === 'tool_use' ? (
            <ToolUseBlock
              key={i}
              b={b}
              result={b.toolCallId ? results.get(b.toolCallId) : undefined}
            />
          ) : (
            <TextBlock key={i} b={b} />
          ),
        )}
        {a.status === 'failed' && a.error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-1.5 text-[12px]">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
            <span>
              <b className="text-ink">{t('liveSession.details.streamInterrupted')}</b> (
              {a.error.status ?? '—'}: <span className="font-mono">{a.error.message}</span>).{' '}
              {t('liveSession.details.partialNote')}{' '}
              {a.error.next === 'fallback'
                ? t('liveSession.details.retryingNext')
                : t('liveSession.details.noRoute')}
            </span>
          </div>
        )}
        {a.status === 'cancelled' && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-s2 px-3 py-1.5 text-[12px] text-muted">
            <OctagonX size={14} className="shrink-0" />{' '}
            {t('liveSession.details.cancelled', { secs: fmtSecs(a.latencyMs ?? 0) })}
          </div>
        )}
        {opts.showMeta && a.status !== 'waiting' && (
          <div className="space-y-1.5 rounded-md bg-s2/60 px-2.5 py-2">
            <RequestTimeline a={a} />
            {a.status === 'done' && (
              <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
                <span>{a.requestId}</span>
                <span>{t('liveSession.details.stop', { reason: a.stopReason ?? '—' })}</span>
                {a.usage && (
                  <span>
                    {t('liveSession.details.usage', {
                      input: fmtInt(a.usage.input),
                      cache: fmtInt(a.usage.cacheRead),
                      output: fmtInt(a.usage.output),
                    })}
                    {a.usage.cacheWrite
                      ? ` ${t('liveSession.details.cacheWrite', { n: fmtInt(a.usage.cacheWrite) })}`
                      : ''}
                    {a.usage.reasoning
                      ? ` ${t('liveSession.details.reasoning', { n: fmtInt(a.usage.reasoning) })}`
                      : ''}
                  </span>
                )}
                <span>{fmtUsd(a.costUsd ?? 0)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-soft">
        <CircleUser size={15} />
      </div>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-tr-sm bg-accent-tint px-3 py-2 text-[14px] text-ink">
        {text}
      </div>
    </div>
  );
}

const hasCall = (items: LiveItem[], id?: string) =>
  items.some((a) => a.kind === 'attempt' && a.blocks.some((b) => b?.toolCallId === id));

export function DetailsView({ state, opts }: { state: LiveState; opts: ViewOpts }) {
  const results = useToolResults(state);
  return (
    <>
      {state.items.map((it) => {
        if (it.kind === 'attempt')
          return <AttemptDetails key={it.attemptId} a={it} results={results} opts={opts} />;
        if (it.role === 'tool' && hasCall(state.items, it.toolCallId)) return null;
        if (it.role === 'system')
          return (
            <Collapsible
              key={`m${it.seq}`}
              icon={<ScrollText size={14} className="shrink-0 text-muted" />}
              title={t('liveSession.details.systemPrompt')}
              meta={t('liveSession.chars', { n: fmtInt(it.text.length) })}
              defaultOpen={false}
            >
              <div className="whitespace-pre-wrap font-mono text-[12px] text-dim">{it.text}</div>
            </Collapsible>
          );
        if (it.role === 'tool')
          return (
            <Collapsible
              key={`m${it.seq}`}
              icon={<Wrench size={14} className="shrink-0 text-warn" />}
              title={
                <>
                  {t('liveSession.tool.resultTitle')}{' '}
                  <span className="font-mono text-[11px] text-muted">{it.name}</span>
                </>
              }
              defaultOpen={false}
            >
              <div className="whitespace-pre-wrap font-mono text-[12px] text-dim">{it.text}</div>
            </Collapsible>
          );
        return <UserBubble key={`m${it.seq}`} text={it.text} />;
      })}
    </>
  );
}

// --------------------------------------------------------------------- chat

/**
 * What the person using the harness saw: their prompts and the answers.
 * Retries are invisible, tools are small chips, thinking is one quiet line.
 */
export function ChatView({ state, opts }: { state: LiveState; opts: ViewOpts }) {
  const results = useToolResults(state);
  const turns: ReactNode[] = [];
  // Group the attempts between two user prompts into one assistant turn.
  let group: LiveAttempt[] = [];
  const flush = (key: string) => {
    if (!group.length) return;
    turns.push(<ChatAssistantTurn key={key} attempts={group} results={results} opts={opts} />);
    group = [];
  };
  for (const it of state.items) {
    if (it.kind === 'attempt') group.push(it);
    else if (it.role === 'system') {
      flush(`a${it.seq}`);
      turns.push(
        <Collapsible
          key={`s${it.seq}`}
          icon={<ScrollText size={14} className="shrink-0 text-muted" />}
          title={t('liveSession.details.systemPrompt')}
          meta={t('liveSession.chars', { n: fmtInt(it.text.length) })}
          defaultOpen={false}
        >
          <div className="whitespace-pre-wrap font-mono text-[12px] text-dim">{it.text}</div>
        </Collapsible>,
      );
    } else if (it.role === 'user') {
      flush(`a${it.seq}`);
      turns.push(
        <div key={`u${it.seq}`} className="flex justify-end">
          <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-on-accent">
            {it.text}
          </div>
        </div>,
      );
    }
  }
  flush('last');
  return <>{turns}</>;
}

function ChatThinking({ b }: { b: LiveBlock }) {
  const now = useNow(!b.done && !b.endedTs);
  const [open, setOpen] = useState(false);
  const live = !b.done && !b.endedTs;
  const text = b.redacted && !b.text ? t('liveSession.thinking.encrypted') : b.text;
  return (
    <div className="text-[13px]">
      <button
        type="button"
        className="flex items-center gap-1.5 text-muted hover:text-ink"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Brain size={13} className="text-[var(--port-2)]" />
        <span className={cx(live && 'animate-pulse')}>
          {live
            ? t('liveSession.thinking.chat')
            : t('liveSession.thinking.thoughtFor', {
                secs: fmtSecs((b.endedTs ?? now) - b.startedTs),
              })}
        </span>
        <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} />
      </button>
      {(open || live) && (
        <div
          className={cx(
            'mt-1 border-l-2 border-[color-mix(in_srgb,var(--port-2)_40%,transparent)] pl-3 italic text-muted',
            live && !open && 'line-clamp-3',
          )}
        >
          {live && !open ? text.slice(-260) : text}
        </div>
      )}
    </div>
  );
}

function ChatToolChip({ b, result }: { b: LiveBlock; result?: LiveMessage }) {
  const [open, setOpen] = useState(false);
  const running = !result;
  return (
    <div className="text-[12px]">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-s2 px-2.5 py-0.5 text-dim hover:bg-s3"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Wrench size={12} className={cx('shrink-0 text-warn', running && 'animate-pulse')} />
        <span className="font-medium">
          {running
            ? t('liveSession.tool.using', { name: b.name ?? '' })
            : t('liveSession.tool.used', { name: b.name ?? '' })}
        </span>
        <span className="truncate font-mono text-muted">{toolSummary(b)}</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-s2 p-2 font-mono text-[11px] text-dim">
          {result ? result.text : prettyJson(b.text, b.done)}
        </pre>
      )}
    </div>
  );
}

function ChatAssistantTurn({
  attempts,
  results,
  opts,
}: {
  attempts: LiveAttempt[];
  results: Map<string, LiveMessage>;
  opts: ViewOpts;
}) {
  const now = useNow(true);
  // A failed attempt is replaced by the next one: only what reached the harness counts.
  const shown = attempts.filter((a) => a.status !== 'failed' || a === attempts.at(-1));
  const last = attempts.at(-1)!;
  const retrying = last.status === 'waiting' && last.attempt > 1;
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-s3 text-dim">
        <Bot size={15} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {shown.map((a) => (
          <div key={a.attemptId} className="space-y-2">
            {blocksOf(a).map((b, i) =>
              b.type === 'thinking' ? (
                opts.showThinking ? (
                  <ChatThinking key={i} b={b} />
                ) : null
              ) : b.type === 'tool_use' ? (
                <ChatToolChip
                  key={i}
                  b={b}
                  result={b.toolCallId ? results.get(b.toolCallId) : undefined}
                />
              ) : a.status === 'failed' ? null : (
                <TextBlock key={i} b={b} />
              ),
            )}
            {a.status === 'cancelled' && (
              <div className="text-[12px] italic text-muted">
                {t('liveSession.chat.interrupted')}
              </div>
            )}
            {a.status === 'failed' && a.error?.next === 'give_up' && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-[13px] text-ink">
                <TriangleAlert size={14} className="shrink-0 text-danger" />{' '}
                {t('liveSession.chat.failed', { status: String(a.error.status ?? '—') })}
              </div>
            )}
          </div>
        ))}
        {(last.status === 'waiting' ||
          (last.status === 'failed' && last.error?.next === 'fallback')) && (
          <div
            className="flex items-center gap-1 py-1"
            title={
              retrying
                ? t('liveSession.chat.retrying')
                : t('liveSession.chat.waiting', { secs: fmtSecs(now - last.startedTs) })
            }
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-bounce rounded-full bg-faint"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- inspector

function Code({ children, max = 'max-h-64' }: { children: ReactNode; max?: string }) {
  return (
    <pre
      className={cx(
        'm-0 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-2 font-mono text-[11px] leading-snug text-dim',
        max,
      )}
    >
      {children}
    </pre>
  );
}

/** The request line, headers and body Thinker sent upstream (wire text, not UI copy). */
function requestText(a: LiveAttempt): string {
  const head = Object.entries(a.headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body, null, 2);
  return `POST ${a.endpoint ?? ''}\n${head}\n\n${body ?? ''}`;
}

/** The provider's answer: HTTP error JSON, or the stream rebuilt from the deltas. */
function responseText(a: LiveAttempt, frames: string[]): string {
  if (a.status === 'failed' && !a.error?.interrupted)
    return `HTTP/1.1 ${a.error?.status ?? ''}\ncontent-type: application/json\n\n${JSON.stringify({ error: { message: a.error?.message } }, null, 2)}`;
  const tail =
    a.status === 'failed'
      ? `\n✕ ${t('liveSession.inspector.connectionClosed', { message: a.error?.message ?? '' })}`
      : a.status === 'cancelled'
        ? `\n✕ ${t('liveSession.inspector.harnessClosed')}`
        : a.status === 'done'
          ? ''
          : '\n…';
  return `HTTP/1.1 200\ncontent-type: text/event-stream\n\n${frames.join('\n')}${tail}`;
}

function AttemptInspector({ a, open }: { a: LiveAttempt; open: boolean }) {
  const frames = liveProviderFrames(a);
  const recorded = a.headers !== undefined || a.body !== undefined;
  const status =
    a.status === 'failed'
      ? `${a.error?.status ?? '—'}${a.error?.interrupted ? ` ${t('liveSession.inspector.streamCut')}` : ''}`
      : a.status === 'cancelled'
        ? t('liveSession.inspector.clientClosed')
        : a.status === 'done'
          ? '200'
          : a.status === 'waiting'
            ? t('liveSession.inspector.waiting')
            : t('liveSession.inspector.streaming');
  return (
    <Collapsible
      tone={a.status === 'failed' ? 'danger' : 'muted'}
      icon={
        <span
          className={cx(
            'size-2 shrink-0 rounded-full',
            a.status === 'failed'
              ? 'bg-danger'
              : a.status === 'done'
                ? 'bg-ok'
                : a.status === 'cancelled'
                  ? 'bg-faint'
                  : 'animate-pulse bg-accent',
          )}
        />
      }
      title={
        <span className="font-mono text-[12px]">
          {a.attemptId} · {a.provider} · {a.model}
        </span>
      }
      meta={status}
      defaultOpen={open}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span className="font-mono">{a.requestId}</span>
          <a
            className="link-action inline-flex items-center gap-1"
            href={`/requests/${encodeURIComponent(a.requestId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={12} /> {t('liveSession.inspector.openRequest')}
          </a>
        </div>
        {recorded ? (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span>{t('liveSession.inspector.requestTitle')}</span>
                <span className="font-mono normal-case tracking-normal">{a.upstream}</span>
              </div>
              <Code max="max-h-80">{requestText(a)}</Code>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t('liveSession.inspector.responseTitle', { n: frames.length })}
              </div>
              <Code max="max-h-80">{responseText(a, frames)}</Code>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-line bg-s2 px-3 py-2 text-[12px] text-muted">
            {t('liveSession.inspector.notRecorded')}
          </div>
        )}
      </div>
    </Collapsible>
  );
}

/** Raw exchange with the provider, per attempt (after Thinker's translation). */
export function InspectorView({ state }: { state: LiveState }) {
  const attempts = state.items.filter((i): i is LiveAttempt => i.kind === 'attempt');
  if (!attempts.length)
    return (
      <div className="py-16 text-center text-[13px] text-muted">
        {t('liveSession.inspector.empty')}
      </div>
    );
  return (
    <>
      <p className="text-[12px] text-muted">{t('liveSession.inspector.hint')}</p>
      {attempts.map((a, i) => (
        <AttemptInspector key={a.attemptId} a={a} open={i === attempts.length - 1} />
      ))}
    </>
  );
}

// ------------------------------------------------------------------ compact

interface Entry {
  key: string;
  icon: ReactNode;
  text: string;
  live: boolean;
  tone?: 'danger' | 'muted';
}

/** Everything that happened, as one line each (the short view shows the last three). */
export function compactEntries(state: LiveState, showThinking: boolean): Entry[] {
  const out: Entry[] = [];
  const results = new Map<string, LiveMessage>();
  for (const it of state.items)
    if (it.kind === 'message' && it.role === 'tool' && it.toolCallId)
      results.set(it.toolCallId, it);
  for (const it of state.items) {
    if (it.kind === 'message') {
      if (it.role === 'user')
        out.push({
          key: `u${it.seq}`,
          icon: <CircleUser size={13} className="text-accent" />,
          text: it.text,
          live: false,
        });
      continue;
    }
    if (it.status === 'waiting')
      out.push({
        key: `${it.attemptId}w`,
        icon: <Bot size={13} className="text-muted" />,
        text: t('liveSession.compact.waiting', { model: it.model }),
        live: true,
        tone: 'muted',
      });
    it.blocks.forEach((b, i) => {
      if (!b) return;
      const live = !b.done && !b.endedTs;
      const key = `${it.attemptId}.${i}`;
      if (b.type === 'thinking') {
        if (showThinking)
          out.push({
            key,
            icon: <Brain size={13} className="text-[var(--port-2)]" />,
            text: b.redacted && !b.text ? t('liveSession.thinking.encrypted') : b.text.slice(-220),
            live,
            tone: 'muted',
          });
      } else if (b.type === 'tool_use') {
        const r = b.toolCallId ? results.get(b.toolCallId) : undefined;
        out.push({
          key,
          icon: <Wrench size={13} className="text-warn" />,
          text: `${b.name ?? ''} ${toolSummary(b)}${r ? ' ✓' : b.done ? ` · ${t('liveSession.compact.running')}` : ''}`,
          live: live || (b.done && !r),
        });
      } else
        out.push({
          key,
          icon: <Bot size={13} className="text-ok" />,
          text: b.text.slice(-300),
          live,
        });
    });
    if (it.status === 'failed')
      out.push({
        key: `${it.attemptId}f`,
        icon: <TriangleAlert size={13} className="text-danger" />,
        text: `${it.provider}: ${it.error?.status ?? ''} ${it.error?.message ?? ''}`,
        live: false,
        tone: 'danger',
      });
    if (it.status === 'cancelled')
      out.push({
        key: `${it.attemptId}c`,
        icon: <OctagonX size={13} className="text-muted" />,
        text: t('liveSession.compact.cancelled'),
        live: false,
        tone: 'muted',
      });
  }
  return out;
}

/** Short mode: only the last three things that happened, updating live. */
export function CompactView({ state, showThinking }: { state: LiveState; showThinking: boolean }) {
  const last = compactEntries(state, showThinking).slice(-3);
  if (!last.length)
    return <div className="px-3 py-3 text-[12px] text-muted">{t('liveSession.compact.empty')}</div>;
  return (
    <div className="divide-y divide-line">
      {last.map((e) => (
        <div
          key={e.key}
          className={cx(
            'flex gap-2 px-3 py-2 text-[12px] leading-snug',
            e.tone === 'danger' && 'bg-danger-tint',
            e.tone === 'muted' && 'italic text-muted',
          )}
        >
          <span className="mt-0.5 shrink-0">{e.icon}</span>
          <span
            className={cx(
              'line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words',
              !e.tone && 'text-ink',
            )}
          >
            {e.text}
            {e.live && <Caret />}
          </span>
        </div>
      ))}
    </div>
  );
}
