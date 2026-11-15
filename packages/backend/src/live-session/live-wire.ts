import {
  SHARED_PROVIDER_BY_ID_OR_ALIAS,
  type LiveEvent,
  type LiveSessionMeta,
  type LiveUsage,
} from 'thinker-shared';
import type { StreamUsage } from '../routing/proxy/stream-writer';
import { scrubSecrets } from '../common/utils/secret-scrub';

/** Helpers shared by the live session hub, the proxy tap and the history. */

const MASK = '••••••••';
const SECRET_HEADER_RE =
  /(auth|token|secret|cookie|api[-_]?key|password|signature|credential|session)/i;
const SAFE_HEADERS = new Set(['anthropic-version', 'anthropic-beta', 'content-type', 'accept']);
const SECRET_QUERY_RE =
  /([?&](?:key|api_key|apikey|api-key|token|access_token|secret|password)=)[^&#]*/gi;

/** Provider-facing headers with every credential masked (the scheme is kept). */
export function maskHeaders(
  headers: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (SAFE_HEADERS.has(lower) || !SECRET_HEADER_RE.test(lower)) {
      out[lower] = scrubSecrets(String(value));
      continue;
    }
    const scheme = /^(Bearer|Basic|Token)\s+/i.exec(String(value));
    out[lower] = scheme ? `${scheme[1]} ${MASK}` : MASK;
  }
  return out;
}

export function maskUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(SECRET_QUERY_RE, `$1***`);
}

/** The harness (client application) a session's headers name. */
export function harnessName(
  headers: Record<string, string | string[] | undefined> | null | undefined,
): string | null {
  if (!headers) return null;
  const has = (name: string) => headers[name] !== undefined && headers[name] !== '';
  if (has('x-claude-code-session-id')) return 'Claude Code';
  if (has('x-openclaw-session-key')) return 'OpenClaw';
  if (has('x-opencode-session-id') || has('x-opencode-session')) return 'OpenCode';
  if (has('x-hermes-session-id') || has('x-hermes-session-key')) return 'Hermes Agent';
  if (has('x-deepseek-harness-session-id')) return 'DeepSeek Harness';
  if (has('x-openwebui-chat-id')) return 'Open WebUI';
  if (has('originator') || has('session-id') || has('x-codex-parent-thread-id')) return 'Codex CLI';
  return null;
}

/** Display name of a provider id; custom providers resolve through `custom`. */
export function providerDisplayName(
  provider: string | null | undefined,
  custom?: ReadonlyMap<string, string>,
): string {
  if (!provider) return 'unknown';
  if (provider.startsWith('custom:')) {
    return custom?.get(provider.slice('custom:'.length)) ?? 'Custom provider';
  }
  return SHARED_PROVIDER_BY_ID_OR_ALIAS.get(provider.toLowerCase())?.displayName ?? provider;
}

/** A model id without the internal `custom:<uuid>/` prefix. */
export function displayModel(model: string | null | undefined): string {
  if (!model) return 'unknown';
  return model.replace(/^custom:[^/]+\//, '');
}

export function toLiveUsage(
  usage: StreamUsage | null | undefined,
  reasoning = 0,
): LiveUsage | null {
  if (!usage) return null;
  return {
    input: usage.prompt_tokens ?? 0,
    output: usage.completion_tokens ?? 0,
    cacheRead: usage.cache_read_tokens ?? 0,
    cacheWrite: usage.cache_creation_tokens ?? 0,
    reasoning,
  };
}

const MAX_ERROR_MESSAGE = 1000;

/** A readable message out of a provider error body (JSON or text). */
export function errorMessageFrom(body: unknown): string {
  let value: unknown = body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      // plain text
    }
  }
  let message: string | undefined;
  if (typeof value === 'string') message = value;
  else if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const error =
      rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>) : null;
    message =
      (typeof error?.message === 'string' ? error.message : undefined) ??
      (typeof rec.error === 'string' ? rec.error : undefined) ??
      (typeof rec.message === 'string' ? rec.message : undefined) ??
      JSON.stringify(value);
  }
  const clean = scrubSecrets(message ?? '').trim();
  return clean.length > MAX_ERROR_MESSAGE ? `${clean.slice(0, MAX_ERROR_MESSAGE)}…` : clean;
}

/** One SSE message for an already serialized event. */
export function sseFrame(event: LiveEvent, json: string): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${json}\n\n`;
}

/** Access a viewer has to the Inspector parts of `request.started`. */
export interface LiveViewerAccess {
  /** Provider-facing request bodies (the attempt recording rule). */
  bodies: boolean;
  /** Provider-facing headers, credentials masked (the request headers rule). */
  headers: boolean;
}

export type LiveAccessKey = 'full' | 'body' | 'none' | 'headers';

export function accessKey(access: LiveViewerAccess): LiveAccessKey {
  if (access.bodies && access.headers) return 'full';
  if (access.bodies) return 'body';
  if (access.headers) return 'headers';
  return 'none';
}

/** The event as a viewer with `access` may see it. */
export function eventForViewer(event: LiveEvent, access: LiveViewerAccess): LiveEvent {
  if (event.type !== 'request.started') return event;
  const data = event.data;
  const dropHeaders = !access.headers && 'headers' in data;
  const dropBody = !access.bodies && 'body' in data;
  if (!dropHeaders && !dropBody) return event;
  const copy: Record<string, unknown> = { ...data };
  if (dropHeaders) delete copy.headers;
  if (dropBody) delete copy.body;
  return { ...event, data: copy };
}

/** Session meta on the wire; `title` is an extra field the shared type allows. */
export type LiveSessionMetaWire = LiveSessionMeta & { title?: string | null };

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const MAX_TITLE = 80;

/** A session title out of its first user prompt (first line, trimmed). */
export function titleFromPrompt(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = text
    .replace(REMINDER_RE, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

/** Fills `meta.title` from the first user message of a list, once. */
export function fillTitle(
  meta: LiveSessionMetaWire,
  messages: Array<{ role: string; text: string }>,
): void {
  if (meta.title) return;
  const title = titleFromPrompt(messages.find((m) => m.role === 'user')?.text);
  if (title) meta.title = title;
}
