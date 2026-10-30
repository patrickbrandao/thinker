import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, SquareFunction } from 'lucide-react';
import { extractRequestMessages, extractRequestTools, type ChatTool } from 'thinker-shared';
import type { AttemptRecording } from '../services/api/messages.js';
import { parseResponse, type ResponsePart, type StreamEvent } from '../lib/response-parts.js';
import { formatParamValue } from './MessageDetailsSections.js';
import {
  ConversationSplit,
  Empty,
  MarkdownContent,
  TruncatedId,
  toolArguments,
} from './RequestMessages.js';
import JsonBlock from './JsonBlock.js';
import JsonExplorer from './JsonExplorer.js';
import { intlLocale, t } from '../i18n/index.js';
import { cx } from './ui.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Request-body keys rendered by the conversation or the Tools tab, not as parameters. */
const CONVERSATION_KEYS = new Set([
  'messages',
  'input',
  'contents',
  'system',
  'instructions',
  'tools',
]);

function KvRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(96px,180px)_1fr] items-baseline gap-3 border-b border-line py-1.5 text-xs">
      <span className="font-mono text-muted">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all font-mono text-ink">{children}</span>
    </div>
  );
}

function Collapsible({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-control border border-line bg-elev">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="eyebrow">{title}</span>
        {badge}
        <ChevronDown
          className={cx('ml-auto size-4 text-faint transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="border-t border-line px-3 py-2">{children}</div> : null}
    </section>
  );
}

/* ── Request ─────────────────────────────────────────────────────────── */

export function RequestView({
  recording,
  fallbackParams,
}: {
  recording: AttemptRecording | null;
  fallbackParams?: Record<string, unknown>;
}) {
  const body = recording?.request_body;
  const messages = useMemo(() => (body ? extractRequestMessages(body) : []), [body]);
  const params = body
    ? Object.entries(isRec(body.request) ? { ...body, ...body.request } : body).filter(
        ([key]) => !CONVERSATION_KEYS.has(key) && key !== 'request',
      )
    : Object.entries(fallbackParams ?? {});

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[40%] shrink-0 overflow-y-auto p-3">
        {!recording ? (
          <div className="mb-2 text-xs text-muted">{t('messages.recording.noRecordingParams')}</div>
        ) : null}
        <Collapsible
          title={t('messages.recording.parameters')}
          badge={<span className="badge mono">{params.length}</span>}
        >
          {params.length > 0 ? (
            params
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <KvRow key={key} label={key}>
                  {formatParamValue(value)}
                </KvRow>
              ))
          ) : (
            <div className="text-xs text-faint">—</div>
          )}
        </Collapsible>
        {recording ? (
          <div className="mt-2 text-xs text-faint">
            {/* i18n-ignore: wire format identifier */}
            wire_format: <code className="font-mono">{recording.wire_format}</code>
          </div>
        ) : null}
      </div>
      {messages.length > 0 ? (
        <div className="min-h-0 flex-1 border-t border-line">
          <ConversationSplit messages={messages} />
        </div>
      ) : null}
    </div>
  );
}

/* ── Response ────────────────────────────────────────────────────────── */

function ArgsView({ args }: { args: unknown }) {
  const parsed = toolArguments(args);
  if (isRec(parsed)) {
    return (
      <div>
        {Object.entries(parsed).map(([k, v]) => (
          <KvRow key={k} label={k}>
            {formatParamValue(v)}
          </KvRow>
        ))}
      </div>
    );
  }
  return parsed === '' ? null : <JsonBlock value={parsed} />;
}

function PartCard({ part }: { part: ResponsePart }) {
  if (part.kind === 'thinking') {
    return (
      <Collapsible title={t('messages.recording.thinking')}>
        <div className="whitespace-pre-wrap text-sm italic text-muted">{part.text}</div>
      </Collapsible>
    );
  }
  if (part.kind === 'refusal') {
    return (
      <Collapsible title={t('messages.recording.refusal')}>
        <div className="whitespace-pre-wrap text-sm text-danger">{part.text}</div>
      </Collapsible>
    );
  }
  if (part.kind === 'tool_call') {
    return (
      <Collapsible
        title={t('messages.recording.toolCall')}
        badge={
          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
            <span className="text-muted">function</span>
            <strong className="text-ink">{part.name ?? t('messages.recording.unknownTool')}</strong>
            {part.id ? <TruncatedId id={part.id} /> : null}
          </span>
        }
      >
        <ArgsView args={part.arguments} />
      </Collapsible>
    );
  }
  return (
    <Collapsible title={t('messages.recording.text')}>
      <MarkdownContent class="break-words text-sm text-dim" text={part.text} />
    </Collapsible>
  );
}

function EventRow({ event }: { event: StreamEvent }) {
  const [open, setOpen] = useState(false);
  const preview = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  return (
    <div className="border-b border-line">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1 text-left font-mono text-xs hover:bg-s2"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-8 shrink-0 text-right text-faint">{event.index + 1}</span>
        <span className="shrink-0 text-accent-soft">{event.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{preview}</span>
      </button>
      {open ? (
        <div className="px-2 pb-2">
          <JsonBlock value={event.data} />
        </div>
      ) : null}
    </div>
  );
}

function usageSummary(usage: unknown): string | null {
  if (!isRec(usage)) return null;
  return Object.entries(usage)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k}=${(v as number).toLocaleString(intlLocale())}`)
    .join('  ');
}

export function ResponseView({
  recording,
  pending,
}: {
  recording: AttemptRecording | null;
  pending: boolean;
}) {
  const parsed = useMemo(() => parseResponse(recording?.response_body ?? null), [recording]);
  if (parsed.mode === 'none') {
    return (
      <Empty>
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span className="spinner" aria-hidden="true" />
            {t('messages.recording.waitingResponse')}
          </span>
        ) : (
          t('messages.recording.noResponse')
        )}
      </Empty>
    );
  }
  const meta = parsed.meta;
  const finish = meta.finish_reason ?? meta.stop_reason;
  const usage = usageSummary(meta.usage);
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="badge">
          {parsed.mode === 'stream'
            ? t('messages.recording.streamed', { count: parsed.events.length })
            : t('messages.recording.whole')}
        </span>
        {meta.model ? (
          <span>
            <span className="text-muted">{t('messages.recording.responseModel')}</span>{' '}
            <code className="font-mono">{String(meta.model)}</code>
          </span>
        ) : null}
        {finish ? (
          <span>
            <span className="text-muted">{t('messages.recording.finishReason')}</span>{' '}
            <code className="font-mono">{String(finish)}</code>
          </span>
        ) : null}
        {meta.id ? (
          <span>
            <span className="text-muted">{t('messages.recording.responseId')}</span>{' '}
            <code className="font-mono">{String(meta.id)}</code>
          </span>
        ) : null}
        {usage ? (
          <span>
            <span className="text-muted">{t('messages.recording.usage')}</span>{' '}
            <code className="font-mono">{usage}</code>
          </span>
        ) : null}
        {pending ? (
          <span className="spinner" aria-label={t('messages.drawer.autoRefresh')} />
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {parsed.parts.map((part, i) => (
          <PartCard key={i} part={part} />
        ))}
        {parsed.mode === 'stream' ? (
          <Collapsible
            title={t('messages.recording.events')}
            badge={<span className="badge mono">{parsed.events.length}</span>}
            defaultOpen={false}
          >
            <div className="max-h-[480px] overflow-y-auto">
              {parsed.events.map((event) => (
                <EventRow key={event.index} event={event} />
              ))}
            </div>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
}

/* ── Tools ───────────────────────────────────────────────────────────── */

interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

const SHORT_TYPES: Record<string, string> = {
  string: 'str',
  boolean: 'bool',
  integer: 'int',
  number: 'float',
  object: 'obj',
  array: 'arr',
};

const shortType = (type: unknown): string => SHORT_TYPES[String(type)] ?? String(type);

function schemaType(schema: unknown): string {
  if (!isRec(schema)) return 'any';
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  }
  if (Array.isArray(schema.type)) return schema.type.map(shortType).join(' | ');
  if (typeof schema.type === 'string') return shortType(schema.type);
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return union.map(schemaType).join(' | ');
  return 'any';
}

export function toolParams(parameters: unknown): ParamInfo[] {
  if (!isRec(parameters) || !isRec(parameters.properties)) return [];
  const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);
  return Object.entries(parameters.properties).map(([name, schema]) => ({
    name,
    type: schemaType(schema),
    required: required.has(name),
    description:
      isRec(schema) && typeof schema.description === 'string' ? schema.description : undefined,
  }));
}

/** `ƒ name(str query, int limit)`: types gray, required names blue, optional names green. */
function Signature({ kind, name, params }: { kind: string; name: string; params: ParamInfo[] }) {
  return (
    <code className="inline-flex flex-wrap items-center font-mono text-sm">
      {kind === 'function' ? (
        <SquareFunction className="mr-1.5 size-4 shrink-0 text-muted" aria-label={kind} />
      ) : (
        <span className="text-muted">{kind}&nbsp;</span>
      )}
      <strong className="text-ink">{name}</strong>
      <span className="text-faint">(</span>
      {params.map((p, i) => (
        <span key={p.name}>
          {i > 0 ? <span className="text-faint">, </span> : null}
          <span className="text-muted">{p.type}</span>{' '}
          <span className={p.required ? 'tool-key' : 'tool-opt'}>{p.name}</span>
        </span>
      ))}
      <span className="text-faint">)</span>
    </code>
  );
}

function DeclaredTool({ tool }: { tool: ChatTool }) {
  const [open, setOpen] = useState(false);
  const params = toolParams(tool.function?.parameters);
  const name = tool.function?.name ?? t('messages.recording.unknownTool');
  return (
    <div>
      <button
        type="button"
        className="tool-card flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-control px-3 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Signature kind={tool.type ?? 'function'} name={name} params={params} />
      </button>
      {open ? (
        <div className="tool-card tool-card__panel mt-1 ml-[75px] rounded-control px-3 py-2">
          {tool.function?.description ? (
            <p className="m-0 mb-2 whitespace-pre-wrap font-mono text-xs leading-normal text-muted">
              {tool.function.description}
            </p>
          ) : null}
          {params.length > 0 ? (
            <table className="w-full text-xs">
              <tbody>
                {params.map((p) => (
                  <tr key={p.name} className="align-baseline">
                    <td className={cx('py-1 pr-3 font-mono', p.required ? 'tool-key' : 'tool-opt')}>
                      {p.name}
                    </td>
                    <td className="py-1 pr-3 font-mono text-muted">{p.type}</td>
                    <td className="py-1 pr-3 text-muted">
                      {p.required
                        ? t('messages.recording.required')
                        : t('messages.recording.optional')}
                    </td>
                    <td className="py-1 font-mono text-muted">{p.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-faint">{t('messages.recording.noParams')}</div>
          )}
          {tool.function?.parameters != null ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted">
                {t('messages.recording.showSchema')}
              </summary>
              <JsonBlock value={tool.function.parameters} />
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolsView({
  recording,
  pending,
}: {
  recording: AttemptRecording | null;
  pending: boolean;
}) {
  const declared = useMemo(
    () => (recording ? extractRequestTools(recording.request_body) : []),
    [recording],
  );
  const parsed = useMemo(() => parseResponse(recording?.response_body ?? null), [recording]);
  const calls = parsed.parts.filter(
    (p): p is Extract<ResponsePart, { kind: 'tool_call' }> => p.kind === 'tool_call',
  );
  const answered = parsed.mode !== 'none';
  const declaredByName = new Map(declared.map((tool) => [tool.function?.name, tool]));

  return (
    <div className="h-full overflow-y-auto p-3">
      <section className="mb-5">
        <h4 className="eyebrow mb-2 flex items-center gap-1.5">
          {t('messages.recording.called')}
          {answered ? <span className="badge mono">{calls.length}</span> : null}
        </h4>
        {!answered ? (
          <Empty small>
            {pending ? (
              <span className="inline-flex items-center gap-2">
                <span className="spinner" aria-hidden="true" />
                {t('messages.recording.waitingCalls')}
              </span>
            ) : (
              t('messages.recording.noResponse')
            )}
          </Empty>
        ) : calls.length === 0 ? (
          <Empty small>{t('messages.recording.noToolsCalled')}</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {calls.map((call, i) => {
              const params = toolParams(declaredByName.get(call.name)?.function?.parameters);
              return (
                <article key={call.id ?? i} className="tool-card rounded-control">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Signature
                      kind="function"
                      name={call.name ?? t('messages.recording.unknownTool')}
                      params={params}
                    />
                    {call.id ? <TruncatedId id={call.id} /> : null}
                  </div>
                  <div className="tool-card__details px-3 py-2">
                    <ArgsView args={call.arguments} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section>
        <h4 className="eyebrow mb-2 flex items-center gap-1.5">
          {t('messages.recording.available')}
          <span className="badge mono">{declared.length}</span>
        </h4>
        {declared.length === 0 ? (
          <Empty small>{t('messages.recording.noToolsOffered')}</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {declared.map((tool, i) => (
              <DeclaredTool key={i} tool={tool} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Raw ─────────────────────────────────────────────────────────────── */

type RawSource = 'request' | 'response' | 'events' | 'sse';

export function RawView({ recording }: { recording: AttemptRecording | null }) {
  const [source, setSource] = useState<RawSource>('request');
  const parsed = useMemo(() => parseResponse(recording?.response_body ?? null), [recording]);
  if (!recording) return <Empty>{t('messages.raw.empty')}</Empty>;
  const isStream = recording.response_body?.type === 'stream';
  const sources: Array<{ key: RawSource; label: string }> = [
    { key: 'request', label: t('messages.raw.request') },
    { key: 'response', label: t('messages.raw.response') },
    ...(isStream
      ? ([
          { key: 'events', label: `${t('messages.raw.events')} (${parsed.events.length})` },
          { key: 'sse', label: t('messages.raw.sse') },
        ] as const)
      : []),
  ];
  const active = sources.some((s) => s.key === source) ? source : 'request';
  const value =
    active === 'request'
      ? recording.request_body
      : active === 'events'
        ? parsed.events.map((e) => ({ event: e.name, data: e.data }))
        : recording.response_body?.type === 'json'
          ? recording.response_body.body
          : recording.response_body;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2" role="tablist">
        {sources.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={active === s.key}
            className={cx(
              'cursor-pointer rounded-control border px-2 py-0.5 text-xs',
              active === s.key
                ? 'border-accent bg-accent-tint text-ink'
                : 'border-line bg-transparent text-muted hover:bg-s2',
            )}
            onClick={() => setSource(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active === 'sse' ? (
        <pre className="code m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 text-xs">
          {recording.response_body?.raw_sse ?? ''}
        </pre>
      ) : value == null ? (
        <Empty>{t('messages.raw.empty')}</Empty>
      ) : (
        <JsonExplorer key={active} value={value} />
      )}
    </div>
  );
}
