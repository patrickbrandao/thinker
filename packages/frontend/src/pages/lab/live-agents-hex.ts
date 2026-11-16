/**
 * Lab only: pure logic of the cascade wall (window placement, auto-close and
 * the footer's model / effort). Kept free of React so it is unit-tested and
 * easy to port to the official page.
 */
import { liveSessionStatus, type LiveAttempt, type LiveState } from 'thinker-shared';

// ----------------------------------------------------------------- cascade

export interface CascadeOptions {
  /** Window size, px. */
  width: number;
  height: number;
  /** Area the windows live in (the wall's width and the viewport height). */
  areaWidth: number;
  areaHeight: number;
  /** Offset between consecutive windows, px. */
  step?: number;
  /** Gap to the area edges, px. */
  margin?: number;
}

export const CASCADE_STEP = 28;
export const CASCADE_MARGIN = 12;

/**
 * Where the window in cascade slot `slot` opens. The cascade starts below a
 * free band as tall as one window (so the user can drag the window they care
 * about up into it); each window is offset `step` px right and down from the
 * previous one. A run that would leave the area wraps back to the top of the
 * cascade, shifted right by half a window (and back to the left edge, nudged
 * down half a step, once the runs fill the width).
 */
export function cascadePosition(slot: number, o: CascadeOptions): { x: number; y: number } {
  const step = o.step ?? CASCADE_STEP;
  const margin = o.margin ?? CASCADE_MARGIN;
  const top = margin + o.height + margin;
  const nudge = Math.round(step / 2);
  const fitY = Math.floor((o.areaHeight - margin - top - o.height - nudge) / step) + 1;
  const fitX = Math.floor((o.areaWidth - 2 * margin - o.width) / step) + 1;
  const perRun = Math.max(1, Math.min(fitY, fitX));
  const run = Math.floor(Math.max(0, slot) / perRun);
  const k = Math.max(0, slot) % perRun;
  const spanX = o.areaWidth - 2 * margin - o.width - (perRun - 1) * step - nudge;
  const shift = Math.round(o.width / 2) + step;
  const runsPerRow = spanX > 0 ? Math.floor(spanX / shift) + 1 : 1;
  const col = run % runsPerRow;
  const odd = Math.floor(run / runsPerRow) % 2;
  return {
    x: margin + col * shift + k * step + odd * nudge,
    y: top + k * step + odd * nudge,
  };
}

/** Smallest slot not taken (closed windows free theirs for the next one). */
export function freeSlot(taken: Iterable<number>): number {
  const used = new Set(taken);
  let slot = 0;
  while (used.has(slot)) slot += 1;
  return slot;
}

// -------------------------------------------------------------- auto-close

/** What the session's conversation ends with. */
export type LastItemKind = 'answer' | 'tool' | 'busy';

/**
 * - `answer`: the turn finished with an assistant answer (no pending tool call),
 *   or ended for good (cancelled, failed with no route left).
 * - `tool`: the assistant asked for a tool, or a tool result is waiting for the
 *   harness's next request.
 * - `busy`: the provider is answering, retrying, or a prompt is on its way.
 */
export function lastItemKind(state: LiveState): LastItemKind {
  const s = liveSessionStatus(state);
  if (s === 'finished' || s === 'cancelled' || s === 'failed') return 'answer';
  if (s === 'tools') return 'tool';
  return 'busy';
}

export interface AutoCloseTimeouts {
  answerMs: number;
  toolMs: number;
}

export const DEFAULT_AUTO_CLOSE: AutoCloseTimeouts = { answerMs: 10_000, toolMs: 60_000 };

export interface AutoCloseInput {
  kind: LastItemKind;
  /** Changes on every new event of the session (the last event id). */
  activity: number;
  pinned: boolean;
  /** The session left the running set. */
  ended: boolean;
  /** The user is hovering or interacting with the window. */
  paused: boolean;
}

/** Countdown of a window, ms; null when it does not close by itself. */
export function closeTimeout(i: Omit<AutoCloseInput, 'paused' | 'activity'>, t: AutoCloseTimeouts) {
  if (i.pinned) return null;
  if (i.kind === 'answer') return t.answerMs;
  // An ended session whose last item is not an answer uses the longer timeout.
  if (i.kind === 'tool' || i.ended) return t.toolMs;
  return null;
}

export interface AutoCloseStatus {
  totalMs: number;
  remainingMs: number;
  paused: boolean;
}

/**
 * One window's auto-close timer. `update` is called with the current session
 * state; any new activity (or a different rule) restarts the countdown, a pause
 * freezes it and a resume continues from where it stopped.
 */
export class AutoCloser {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private totalMs: number | null = null;
  private remainingMs = 0;
  private startedAt = 0;
  private activity: number | null = null;
  private paused = false;
  private closed = false;

  constructor(
    private readonly onClose: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  update(input: AutoCloseInput, timeouts: AutoCloseTimeouts): AutoCloseStatus | null {
    if (this.closed) return null;
    const total = closeTimeout(input, timeouts);
    if (input.activity !== this.activity || total !== this.totalMs) {
      this.clear();
      this.activity = input.activity;
      this.totalMs = total;
      this.remainingMs = total ?? 0;
      this.startedAt = this.now();
      this.paused = false;
    }
    if (input.paused !== this.paused) {
      if (input.paused) {
        this.remainingMs = this.left();
        this.clear();
      } else this.startedAt = this.now();
      this.paused = input.paused;
    }
    if (this.totalMs != null && !this.paused && !this.timer) this.arm();
    return this.status();
  }

  status(): AutoCloseStatus | null {
    if (this.totalMs == null || this.closed) return null;
    return { totalMs: this.totalMs, remainingMs: this.left(), paused: this.paused };
  }

  dispose() {
    this.closed = true;
    this.clear();
  }

  private left() {
    return this.paused || !this.timer
      ? this.remainingMs
      : Math.max(0, this.remainingMs - (this.now() - this.startedAt));
  }

  private arm() {
    this.startedAt = this.now();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.closed = true;
        this.onClose();
      },
      Math.max(0, this.remainingMs),
    );
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// ------------------------------------------------------ footer: model, effort

/** The attempt that answered last (after any fallback); the latest one otherwise. */
export function finalAttempt(state: LiveState): LiveAttempt | null {
  let latest: LiveAttempt | null = null;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (item.kind !== 'attempt') continue;
    if (item.status === 'done' || item.status === 'streaming') return item;
    latest ??= item;
  }
  return latest;
}

const EFFORT_LABEL: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const level = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const k = v.trim().toLowerCase();
  return EFFORT_LABEL[k] ?? v.trim().charAt(0).toUpperCase() + v.trim().slice(1);
};

/** Anthropic `thinking.budget_tokens` mapped to a level. */
export function budgetLevel(tokens: number): string {
  if (tokens < 4_096) return 'Low';
  if (tokens < 16_000) return 'Medium';
  return 'High';
}

/**
 * Reasoning effort a provider-facing request body asks for, or null when it
 * says nothing (or the body is not recorded). Reads OpenAI Chat
 * `reasoning_effort`, Responses `reasoning.effort`, Anthropic
 * `output_config.effort` and `thinking` (budget mapped to Low/Medium/High),
 * and Gemini `thinkingConfig`.
 */
export function effortOf(body: unknown): string | null {
  const b = obj(body);
  if (!b) return null;
  const direct = level(b.reasoning_effort) ?? level(obj(b.reasoning)?.effort);
  if (direct) return direct;
  const anthropic = level(obj(b.output_config)?.effort);
  if (anthropic) return anthropic;
  const thinking = obj(b.thinking);
  if (thinking) {
    if (thinking.type === 'disabled') return 'Off';
    if (typeof thinking.budget_tokens === 'number') return budgetLevel(thinking.budget_tokens);
    if (thinking.type === 'adaptive') return 'Adaptive';
  }
  const gen = obj(b.generationConfig) ?? obj(b.generation_config);
  const tc = obj(gen?.thinkingConfig) ?? obj(gen?.thinking_config);
  if (tc) {
    const lv = level(tc.thinkingLevel ?? tc.thinking_level);
    if (lv) return lv;
    const budget = tc.thinkingBudget ?? tc.thinking_budget;
    if (budget === 0) return 'Off';
    if (budget === -1) return 'Dynamic';
    if (typeof budget === 'number') return budgetLevel(budget);
  }
  return null;
}
