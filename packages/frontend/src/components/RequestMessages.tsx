import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Settings } from 'lucide-react';
import {
  coerceContentToText,
  extractRecordedConversationMessages,
  extractRequestTools,
  normalizeRole,
  type ChatMessage,
  type ChatTool,
  type Role,
  type ToolCall,
} from 'thinker-shared';
import type { AttemptRecording } from '../services/api/messages.js';
import MarkdownContentImpl from './playground/MarkdownContent.js';
import JsonBlock from './JsonBlock.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

// MarkdownContent belongs to the playground area; typed here by its props
// contract so this file does not depend on how that component is written.
export const MarkdownContent = MarkdownContentImpl as unknown as ComponentType<{
  text: string;
  class?: string;
}>;

type Recording = AttemptRecording;
export type RecordingView = 'messages' | 'tools' | 'raw';

const CAP_CHARS = 2000;
const SIDEBAR_DEFAULT = 220;
const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 480;
const ALL_ROLES: Role[] = ['system', 'user', 'assistant', 'tool', 'unknown'];

/** Role chip colors, from the category tokens. */
const ROLE_CLASS: Record<Role, string> = {
  system: 'bg-s3 text-dim',
  user: 'bg-accent-tint text-accent-soft',
  assistant: 'bg-ok-tint text-ok',
  tool: 'bg-warn-tint text-warn',
  unknown: 'bg-s3 text-muted',
};

interface OutlineRow {
  index: number;
  role: Role;
  preview: string;
  tokens: number;
}

export function toolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function previewStr(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? flat.slice(0, 80) + '…' : flat;
}

function approxTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export function TruncatedId({ id }: { id: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLElement>(null);

  const show = () => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.top - 8, left: r.left + r.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <code
      ref={ref}
      className="request-messages__tool-id max-w-[160px] truncate font-mono text-xs text-muted"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {id}
      {pos
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[80] max-w-[320px] break-all rounded-control border border-line bg-elev px-2.5 py-1.5 font-mono text-xs text-dim shadow-[var(--shadow-float)]"
              style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
            >
              {id}
            </span>,
            document.body,
          )
        : null}
    </code>
  );
}

export const ToolIcon = () => (
  <span className="request-messages__tool-icon inline-flex text-muted" aria-hidden="true">
    <Settings className="size-4" />
  </span>
);

function ToolCalls({ calls }: { calls: ToolCall[] }) {
  return (
    <div className="request-messages__tool-calls mt-2 flex flex-col gap-2">
      {calls.map((call, i) => (
        <div key={call.id ?? i} className="request-messages__tool-call well">
          <div className="request-messages__tool-call-head mb-1.5 flex items-center gap-2">
            <ToolIcon />
            <strong className="request-messages__tool-name text-sm text-ink">
              {call.function?.name ?? t('messages.recording.unknownTool')}
            </strong>
            {call.id ? <TruncatedId id={call.id} /> : null}
          </div>
          {call.function?.arguments != null ? (
            <JsonBlock value={toolArguments(call.function?.arguments)} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MessageTurn({
  message,
  index,
  active,
  onRef,
}: {
  message: ChatMessage;
  index: number;
  active: boolean;
  onRef?: (el: HTMLElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [capped, setCapped] = useState(true);

  const role = normalizeRole(message.role);
  const content = coerceContentToText(message.content);
  const toolCalls = message.tool_calls ?? [];

  const parsedJson = useMemo(() => {
    const text = content.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }, [content]);
  const preview = previewStr(content);
  const isCappable = content.length > CAP_CHARS || toolCalls.length > 3;

  return (
    <article
      ref={onRef}
      className={cx(
        'request-message rounded-control border bg-elev',
        active ? 'request-message--active border-accent' : 'border-line',
      )}
    >
      <button
        type="button"
        className="request-message__header flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="request-message__index font-mono text-xs text-faint">#{index + 1}</span>
        <span
          className={cx(
            `request-message__role request-message__role--${role} badge`,
            ROLE_CLASS[role],
          )}
        >
          {/* i18n-ignore: chat protocol role names */}
          {role === 'unknown' ? (message.role ?? 'unknown') : role}
        </span>
        {message.name ? (
          <code className="request-message__meta-code font-mono text-xs text-muted">
            {message.name}
          </code>
        ) : null}
        {message.tool_call_id ? (
          <code className="request-message__meta-code font-mono text-xs text-muted">
            {message.tool_call_id}
          </code>
        ) : null}
        {!expanded && preview ? (
          <span className="request-message__preview min-w-0 flex-1 truncate text-xs text-muted">
            {preview}
          </span>
        ) : null}
        <span
          className={cx(
            'request-message__chevron ml-auto inline-flex text-faint transition-transform',
            expanded && 'request-message__chevron--open rotate-180',
          )}
          aria-hidden="true"
        >
          <ChevronDown className="size-4" />
        </span>
      </button>

      {expanded ? (
        <>
          <div
            className={cx(
              'request-message__body px-3 pb-3 text-sm text-dim',
              isCappable && capped && 'request-message__body--capped max-h-[420px] overflow-hidden',
            )}
          >
            {content ? (
              parsedJson != null ? (
                <JsonBlock className="request-message__content" value={parsedJson} />
              ) : (
                <MarkdownContent class="request-message__content break-words" text={content} />
              )
            ) : null}
            {toolCalls.length > 0 ? <ToolCalls calls={toolCalls} /> : null}
          </div>
          {isCappable ? (
            <div className="request-message__footer border-t border-line px-3 py-1.5">
              <button
                type="button"
                className="request-message__uncap link-action text-xs"
                onClick={() => setCapped((v) => !v)}
              >
                {capped ? t('messages.recording.expandFull') : t('messages.recording.collapseBack')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export function ConversationSplit({ messages }: { messages: ChatMessage[] }) {
  const [activeTurnIndex, setActiveTurnIndex] = useState(-1);
  const [visibleRoles, setVisibleRoles] = useState(() => new Set<Role>(ALL_ROLES));
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [searchQuery, setSearchQuery] = useState('');
  const turnRefs = useRef<Record<number, HTMLElement | null>>({});
  const drag = useRef({ startX: 0, startWidth: 0 });
  const listeners = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const presentRoles = useMemo(() => {
    const roles = new Set<Role>();
    for (const m of messages) roles.add(normalizeRole(m.role));
    return ALL_ROLES.filter((r) => roles.has(r));
  }, [messages]);

  const visibleMessages = messages
    .map((m, i) => ({ message: m, globalIndex: i }))
    .filter(({ message }) => visibleRoles.has(normalizeRole(message.role)));

  const q = searchQuery.toLowerCase().trim();
  const outlineRows = visibleMessages
    .map(({ message, globalIndex }): OutlineRow | null => {
      const text = coerceContentToText(message.content);
      const prev = previewStr(text);
      if (q && !prev.toLowerCase().includes(q)) return null;
      return {
        index: globalIndex,
        role: normalizeRole(message.role),
        preview: prev || '—',
        tokens: approxTokens(text),
      };
    })
    .filter((r): r is OutlineRow => r !== null);

  function jumpTo(globalIndex: number) {
    setActiveTurnIndex(globalIndex);
    turnRefs.current[globalIndex]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  const stopDrag = () => {
    if (!listeners.current) return;
    document.removeEventListener('mousemove', listeners.current.move);
    document.removeEventListener('mouseup', listeners.current.up);
    listeners.current = null;
  };

  function onHandleMouseDown(e: ReactMouseEvent) {
    drag.current = { startX: e.clientX, startWidth: sidebarWidth };
    const move = (ev: MouseEvent) => {
      const delta = ev.clientX - drag.current.startX;
      setSidebarWidth(
        Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, drag.current.startWidth + delta)),
      );
    };
    stopDrag();
    listeners.current = { move, up: stopDrag };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  }

  useEffect(() => stopDrag, []);

  const toggleRole = (role: Role) => {
    setVisibleRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role) && next.size > 1) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  return (
    <div className="conv-split flex h-full min-h-0 flex-col sm:flex-row">
      {/* Rail */}
      <div
        className="conv-rail flex min-h-0 w-full shrink-0 flex-col border-b border-line sm:w-[var(--rail-w)] sm:border-b-0"
        style={{ '--rail-w': `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="conv-rail__search-wrap p-2">
          <input
            className="conv-rail__search field h-8 text-xs"
            type="search"
            placeholder={t('messages.recording.filterPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>
        <div className="conv-rail__roles flex flex-wrap gap-1 px-2 pb-2">
          {presentRoles.map((role) => (
            <button
              key={role}
              type="button"
              className={cx(
                `conv-rail__role-pill conv-rail__role-pill--${role} badge cursor-pointer border-0`,
                ROLE_CLASS[role],
                !visibleRoles.has(role) && 'conv-rail__role-pill--off opacity-40',
              )}
              aria-pressed={visibleRoles.has(role)}
              onClick={() => toggleRole(role)}
              title={t('messages.recording.toggleRole', { role })}
            >
              {role}
            </button>
          ))}
        </div>
        <div className="conv-rail__list max-h-48 min-h-0 flex-1 overflow-y-auto px-1 pb-2 sm:max-h-none">
          {outlineRows.map((row) => (
            <button
              key={row.index}
              type="button"
              className={cx(
                'conv-outline-row flex w-full cursor-pointer items-center gap-1.5 rounded-control border-0 bg-transparent px-1.5 py-1 text-left text-xs hover:bg-s2',
                activeTurnIndex === row.index && 'conv-outline-row--active bg-accent-tint',
              )}
              onClick={() => jumpTo(row.index)}
            >
              <span
                className={cx(
                  `conv-outline-row__badge conv-outline-row__badge--${row.role} badge h-4 px-1 text-[10px]`,
                  ROLE_CLASS[row.role],
                )}
              >
                {row.role.slice(0, 2).toUpperCase()}
              </span>
              <span className="conv-outline-row__num font-mono text-faint">#{row.index + 1}</span>
              <span className="conv-outline-row__preview min-w-0 flex-1 truncate text-dim">
                {row.preview}
              </span>
              <span className="conv-outline-row__tokens font-mono text-faint">{row.tokens}t</span>
            </button>
          ))}
          {outlineRows.length === 0 ? (
            <div className="conv-rail__empty px-2 py-3 text-xs text-faint">
              {t('messages.recording.noMatches')}
            </div>
          ) : null}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="conv-resize-handle hidden w-1 shrink-0 cursor-col-resize bg-line hover:bg-accent sm:block"
        onMouseDown={onHandleMouseDown}
      />

      {/* Turn list */}
      <div className="conv-turns flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {visibleMessages.map(({ message, globalIndex }) => (
          <MessageTurn
            key={globalIndex}
            message={message}
            index={globalIndex}
            active={activeTurnIndex === globalIndex}
            onRef={(el) => {
              turnRefs.current[globalIndex] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function Empty({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div
      className={cx(
        'request-messages__empty flex flex-col items-center gap-1 text-center text-sm text-muted',
        small ? 'request-messages__empty--sm py-3' : 'py-10',
      )}
    >
      {children}
    </div>
  );
}

function ToolsSection({
  title,
  count,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="request-tools-section">
      <h4 className="request-tools-section__title eyebrow mb-2 flex items-center gap-1.5">
        {title}
        <span className="request-tools-section__count badge mono">{count}</span>
      </h4>
      {count > 0 ? (
        <div className="request-messages__tools flex flex-col gap-2">{children}</div>
      ) : (
        <Empty small>{emptyText}</Empty>
      )}
    </section>
  );
}

export default function RequestMessages({
  recording,
  view = 'messages',
}: {
  recording: Recording | null;
  view?: RecordingView;
}) {
  const messages = useMemo(
    () =>
      recording
        ? extractRecordedConversationMessages(recording.request_body, recording.response_body)
        : [],
    [recording],
  );
  const toolCalls = messages.flatMap((m) => m.tool_calls ?? []);
  const availableTools = useMemo(
    () => (recording ? extractRequestTools(recording.request_body) : []),
    [recording],
  );

  if (!recording) {
    return (
      <Empty>
        <div className="request-messages__empty-icon text-2xl text-faint" aria-hidden="true">
          ◌
        </div>
        <strong className="text-ink">{t('messages.recording.noLogsTitle')}</strong>
        <span className="max-w-sm">{t('messages.recording.noLogsBody')}</span>
      </Empty>
    );
  }

  return (
    <div className="request-messages flex h-full min-h-0 flex-col">
      {view === 'messages' ? (
        messages.length > 0 ? (
          <ConversationSplit messages={messages} />
        ) : (
          <div className="request-messages__scroll-area flex-1 overflow-y-auto p-4">
            <Empty>{t('messages.recording.noTurns')}</Empty>
          </div>
        )
      ) : null}

      {view === 'tools' ? (
        <div className="request-messages__scroll-area flex-1 overflow-y-auto p-4">
          <div className="request-messages__tools-page flex flex-col gap-5">
            <ToolsSection
              title={t('messages.recording.called')}
              count={toolCalls.length}
              emptyText={t('messages.recording.noToolsCalled')}
            >
              {toolCalls.map((call, i) => (
                <article key={call.id ?? i} className="request-tool well">
                  <div className="request-tool__head mb-1.5 flex flex-wrap items-center gap-2">
                    <ToolIcon />
                    <strong className="request-messages__tool-name text-sm text-ink">
                      {call.function?.name ?? t('messages.recording.unknownTool')}
                    </strong>
                    {/* i18n-ignore: tool type from the API */}
                    <span className="request-tool__type badge mono">{call.type ?? 'function'}</span>
                    {call.id ? <TruncatedId id={call.id} /> : null}
                  </div>
                  {call.function?.arguments != null ? (
                    <JsonBlock value={toolArguments(call.function?.arguments)} />
                  ) : null}
                </article>
              ))}
            </ToolsSection>

            <ToolsSection
              title={t('messages.recording.available')}
              count={availableTools.length}
              emptyText={t('messages.recording.noToolsOffered')}
            >
              {availableTools.map((tool: ChatTool, i) => (
                <article key={i} className="request-tool request-tool--available well">
                  <div className="request-tool__head mb-1.5 flex flex-wrap items-center gap-2">
                    <strong className="request-messages__tool-name text-sm text-ink">
                      {tool.function?.name ?? t('messages.recording.unknownTool')}
                    </strong>
                    {/* i18n-ignore: tool type from the API */}
                    <span className="request-tool__type badge mono">{tool.type ?? 'function'}</span>
                  </div>
                  {tool.function?.description ? (
                    <p className="request-tool__description mb-1.5 text-xs text-dim">
                      {tool.function.description}
                    </p>
                  ) : null}
                  {tool.function?.parameters != null ? (
                    <JsonBlock value={tool.function?.parameters} />
                  ) : null}
                </article>
              ))}
            </ToolsSection>
          </div>
        </div>
      ) : null}

      {view === 'raw' ? (
        <div className="request-messages__scroll-area flex-1 overflow-y-auto p-4">
          <div className="request-messages__raw flex flex-col gap-4">
            <section>
              <h4 className="eyebrow mb-2">{t('messages.recording.request')}</h4>
              <JsonBlock value={recording.request_body} />
            </section>
            <section>
              <h4 className="eyebrow mb-2">{t('messages.recording.response')}</h4>
              <JsonBlock value={recording.response_body} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
