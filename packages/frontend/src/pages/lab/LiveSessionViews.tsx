/* Lab prototype views of a live session: Chat, Details, Inspector, Compact. */
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
  OctagonX,
  ScrollText,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { MarkdownContent } from '../../components/RequestMessages.js';
import { cx } from '../../components/ui.js';
import {
  providerFrames,
  type LiveAttempt,
  type LiveBlock,
  type LiveItem,
  type LiveMessage,
  type LiveState,
} from './live-session-sim.js';

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

export const fmtInt = (n: number) => n.toLocaleString('en-US');
export const fmtUsd = (n: number) => (n === 0 ? '$0' : `$${n.toFixed(4)}`);
export const fmtSecs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;

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
          `Thought for ${secs}`
        ) : b.endedTs ? (
          `Thinking stopped after ${secs}`
        ) : (
          <span className="animate-pulse">Thinking… {secs}</span>
        )
      }
      meta={`${fmtInt(b.text.length)} chars`}
      defaultOpen={!b.done || !autoCollapse}
    >
      <div className="whitespace-pre-wrap italic leading-relaxed text-dim">
        {b.text}
        {!b.done && !b.endedTs && <Caret />}
      </div>
    </Collapsible>
  );
}

function ToolUseBlock({ b, result }: { b: LiveBlock; result?: LiveMessage }) {
  const state = !b.done
    ? 'streaming args'
    : result
      ? result.isError
        ? 'error'
        : 'result'
      : 'running in harness…';
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
            Tool result
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
  const firstStart = a.blocks[0]?.startedTs ?? end;
  const segs: { kind: keyof typeof SEG_COLOR; from: number; to: number; label: string }[] = [
    {
      kind: 'wait',
      from: a.startedTs,
      to: firstStart,
      label: a.blocks.length ? 'TTFT' : a.status === 'failed' ? 'until error' : 'waiting',
    },
  ];
  for (const b of a.blocks)
    segs.push({
      kind: b.type,
      from: b.startedTs,
      to: b.endedTs ?? (b.done ? b.startedTs : end),
      label: b.type === 'tool_use' ? `${b.name} args` : b.type,
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
        <span>total {fmtSecs(total)}</span>
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
  if (a.status === 'failed' && a.error && a.blocks.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-[13px]">
        <div className="flex items-start gap-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="font-medium text-ink">
              {a.provider} · <span className="font-mono">{a.model}</span> answered {a.error.status}
            </div>
            <div className="font-mono text-[12px] text-dim">{a.error.message}</div>
            <div className="text-[12px] text-muted">
              {a.error.next === 'fallback'
                ? 'Thinker is trying the next route in the chain…'
                : 'No route left: the error went back to the harness.'}
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
          <span className="font-medium text-ink">Assistant</span>
          <span className="font-mono text-muted">{a.model}</span>
          <span className="text-faint">via</span>
          <span className="text-muted">{a.provider}</span>
          {a.attempt > 1 && (
            <span className="rounded bg-warn-tint px-1.5 text-[11px] text-warn">
              attempt {a.attempt}
            </span>
          )}
          <span className="text-faint">· {a.route}</span>
        </div>
        {a.status === 'waiting' && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="size-2 animate-ping rounded-full bg-accent" />
            Waiting for first token… {fmtSecs(now - a.startedTs)}
          </div>
        )}
        {a.blocks.map((b, i) =>
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
              <b className="text-ink">Stream interrupted</b> ({a.error.status}:{' '}
              <span className="font-mono">{a.error.message}</span>). The partial answer above never
              reached the harness as a complete response.{' '}
              {a.error.next === 'fallback' ? 'Retrying on the next route…' : 'No route left.'}
            </span>
          </div>
        )}
        {a.status === 'cancelled' && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-s2 px-3 py-1.5 text-[12px] text-muted">
            <OctagonX size={14} className="shrink-0" /> Cancelled by the harness (client closed the
            connection) after {fmtSecs(a.latencyMs ?? 0)}.
          </div>
        )}
        {opts.showMeta && a.status !== 'waiting' && (
          <div className="space-y-1.5 rounded-md bg-s2/60 px-2.5 py-2">
            <RequestTimeline a={a} />
            {a.status === 'done' && (
              <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
                <span>{a.requestId}</span>
                <span>stop: {a.stopReason}</span>
                {a.usage && (
                  <span>
                    in {fmtInt(a.usage.input)} (cache {fmtInt(a.usage.cacheRead)}) · out{' '}
                    {fmtInt(a.usage.output)}
                    {a.usage.reasoning ? ` (reasoning ${fmtInt(a.usage.reasoning)})` : ''}
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
      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-sm bg-accent-tint px-3 py-2 text-[14px] text-ink">
        {text}
      </div>
    </div>
  );
}

const hasCall = (items: LiveItem[], id?: string) =>
  items.some((a) => a.kind === 'attempt' && a.blocks.some((b) => b.toolCallId === id));

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
              title="System prompt"
              meta={`${it.text.length} chars`}
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
    else if (it.role === 'user') {
      flush(`a${it.seq}`);
      turns.push(
        <div key={`u${it.seq}`} className="flex justify-end">
          <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-on-accent">
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
  return (
    <div className="text-[13px]">
      <button
        type="button"
        className="flex items-center gap-1.5 text-muted hover:text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        <Brain size={13} className="text-[var(--port-2)]" />
        <span className={cx(live && 'animate-pulse')}>
          {live ? 'Thinking…' : `Thought for ${fmtSecs((b.endedTs ?? now) - b.startedTs)}`}
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
          {live && !open ? b.text.slice(-260) : b.text}
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
        onClick={() => setOpen((o) => !o)}
      >
        <Wrench size={12} className={cx('shrink-0 text-warn', running && 'animate-pulse')} />
        <span className="font-medium">
          {running ? 'Using' : 'Used'} {b.name}
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
            {a.blocks.map((b, i) =>
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
              <div className="text-[12px] italic text-muted">Interrupted.</div>
            )}
            {a.status === 'failed' && a.error?.next === 'give_up' && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-[13px] text-ink">
                <TriangleAlert size={14} className="shrink-0 text-danger" /> Something went wrong (
                {a.error.status}). The provider did not answer.
              </div>
            )}
          </div>
        ))}
        {(last.status === 'waiting' ||
          (last.status === 'failed' && last.error?.next === 'fallback')) && (
          <div
            className="flex items-center gap-1 py-1"
            title={
              retrying ? 'Retrying on another route' : `Waiting ${fmtSecs(now - last.startedTs)}`
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

function AttemptInspector({ a, open }: { a: LiveAttempt; open: boolean }) {
  const frames = providerFrames(a);
  const status =
    a.status === 'failed'
      ? `${a.error?.status}${a.error?.interrupted ? ' (stream cut)' : ''}`
      : a.status === 'cancelled'
        ? 'client closed'
        : a.status === 'done'
          ? '200'
          : '200 · streaming';
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
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>Request to provider</span>
            <span className="font-mono normal-case tracking-normal">{a.upstream}</span>
          </div>
          <Code max="max-h-80">
            {`POST ${a.endpoint}\n${Object.entries(a.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}\n\n${JSON.stringify(a.body, null, 2)}`}
          </Code>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Response from provider ({frames.length} frames)
          </div>
          <Code max="max-h-80">
            {a.status === 'failed' && !a.error?.interrupted
              ? `HTTP/1.1 ${a.error?.status}\ncontent-type: application/json\n\n${JSON.stringify({ error: { message: a.error?.message } }, null, 2)}`
              : `HTTP/1.1 200\ncontent-type: text/event-stream\n\n${frames.join('\n')}${a.status === 'failed' ? `\n✕ connection closed: ${a.error?.message}` : a.status === 'cancelled' ? '\n✕ harness closed the connection; Thinker aborted the upstream request' : a.status === 'done' ? '' : '\n…'}`}
          </Code>
        </div>
      </div>
    </Collapsible>
  );
}

/** Raw exchange with the provider, per attempt (after Thinker's translation). */
export function InspectorView({ state }: { state: LiveState }) {
  const attempts = state.items.filter((i): i is LiveAttempt => i.kind === 'attempt');
  if (!attempts.length)
    return <div className="py-16 text-center text-[13px] text-muted">No requests yet.</div>;
  return (
    <>
      <p className="text-[12px] text-muted">
        One entry per attempt. The body is what Thinker sent upstream after routing and translation,
        so the protocol may differ from the harness one. Credentials are masked.
      </p>
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

function entries(state: LiveState, showThinking: boolean): Entry[] {
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
        text: `Waiting for ${it.model}…`,
        live: true,
        tone: 'muted',
      });
    it.blocks.forEach((b, i) => {
      const live = !b.done && !b.endedTs;
      const key = `${it.attemptId}.${i}`;
      if (b.type === 'thinking') {
        if (showThinking)
          out.push({
            key,
            icon: <Brain size={13} className="text-[var(--port-2)]" />,
            text: b.text.slice(-220),
            live,
            tone: 'muted',
          });
      } else if (b.type === 'tool_use') {
        const r = b.toolCallId ? results.get(b.toolCallId) : undefined;
        out.push({
          key,
          icon: <Wrench size={13} className="text-warn" />,
          text: `${b.name} ${toolSummary(b)}${r ? ' ✓' : b.done ? ' · running' : ''}`,
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
        text: `${it.provider}: ${it.error?.status} ${it.error?.message}`,
        live: false,
        tone: 'danger',
      });
    if (it.status === 'cancelled')
      out.push({
        key: `${it.attemptId}c`,
        icon: <OctagonX size={13} className="text-muted" />,
        text: 'Cancelled by the harness',
        live: false,
        tone: 'muted',
      });
  }
  return out;
}

/** Short mode: only the last three things that happened, updating live. */
export function CompactView({ state, showThinking }: { state: LiveState; showThinking: boolean }) {
  const last = entries(state, showThinking).slice(-3);
  if (!last.length) return <div className="px-3 py-3 text-[12px] text-muted">No activity yet.</div>;
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
