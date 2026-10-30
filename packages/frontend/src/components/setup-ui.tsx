/**
 * Building blocks shared by the harness setup guides (Claude Code, Codex,
 * OpenClaw, Hermes…) and the toolkit snippets. Class names prefixed `setup-`
 * are stable hooks for tests; the look comes from tokens and utilities.
 */
import { useMemo, type ReactNode } from 'react';
import { DARK_ICON_VARIANTS } from 'thinker-shared';
import { Eye, EyeOff } from 'lucide-react';
import CopyButton from './CopyButton.jsx';
import { highlight } from '../services/syntax-highlight.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.jsx';
import { effectiveTheme, themePreference } from '../lib/theme.js';
import { useSignal } from '../lib/signal.js';

/**
 * Monochrome brand marks (black glyphs) are inverted on the dark theme so they
 * stay visible. Filter only, no color.
 */
export function monoIconClass(src: string | null | undefined): string | undefined {
  return src &&
    /openai|anthropic|\/vercel\.svg|opencode|hermes|providers\/codex|other|github|copilot\.svg/.test(
      src,
    )
    ? '[.dark_&]:invert'
    : undefined;
}

/** True while the dark theme shows; re-renders when the theme choice changes. */
export function useDarkTheme(): boolean {
  useSignal(themePreference);
  return effectiveTheme() === 'dark';
}

/**
 * The icon to draw for the current theme: the dark variant when one exists
 * (it is already light, so it is not inverted), otherwise the icon itself.
 */
export function themedIcon(src: string, dark: boolean): { src: string; className?: string } {
  const variant = dark ? DARK_ICON_VARIANTS[src] : undefined;
  return variant ? { src: variant } : { src, className: monoIconClass(src) };
}

/**
 * Class for an inline `<code>` chip in setup copy (`auto`, file paths,
 * commands). A plain `<code>` (not a wrapper component) so check:i18n sees
 * the literal as code.
 */
export const CHIP =
  'setup-model-hint__code rounded-[4px] bg-s2 px-1 py-px font-mono text-[12px] text-ink';

/** Card that wraps one harness guide. */
export function SetupCard({ children }: { children: ReactNode }) {
  return <div className="setup-agents-card mt-3 flex flex-col gap-3">{children}</div>;
}

/** Explanatory sentence above a snippet. */
export function SetupHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[13px] leading-relaxed text-dim', className)}>{children}</p>;
}

/** Eye toggle that reveals or masks the API key. */
export function RevealButton({
  revealed,
  onToggle,
  inCode,
}: {
  revealed: boolean;
  onToggle: () => void;
  /** Labels the toggle as acting on the code sample (toolkit snippets). */
  inCode?: boolean;
}) {
  const label = inCode
    ? revealed
      ? t('harnesses.key.hideInCodeAria')
      : t('harnesses.key.revealInCodeAria')
    : revealed
      ? t('harnesses.key.hideAria')
      : t('harnesses.key.revealAria');
  return (
    <button
      type="button"
      className="icon-btn reveal-btn"
      onClick={onToggle}
      aria-label={label}
      title={revealed ? t('harnesses.key.hide') : t('harnesses.key.reveal')}
    >
      {revealed ? <EyeOff /> : <Eye />}
    </button>
  );
}

/**
 * Highlighted snippet with an action row (key reveal + copy) in the corner.
 * `copyText` is what the copy button writes, usually with the real key.
 */
export function SnippetBlock({
  code,
  copyText,
  language,
  reveal,
}: {
  code: string;
  copyText: string;
  language: string;
  reveal?: ReactNode;
}) {
  // highlight() escapes the source before wrapping tokens in spans.
  const html = useMemo(() => highlight(code, language), [code, language]);
  return (
    <div className="setup-cli-block relative">
      <div className="setup-cli-block__actions absolute right-1 top-1 z-[1] flex items-center gap-0.5">
        {reveal}
        <CopyButton text={copyText} />
      </div>
      <pre className="code whitespace-pre-wrap break-all pr-20">
        <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/** Label/value list of the settings a harness asks for. */
export function OnboardFields({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="setup-onboard-fields divide-y divide-line rounded-control border border-line"
      role="list"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** One row of `OnboardFields`. Pass `children` to replace the default value cell. */
export function OnboardField({
  label,
  value,
  copyable,
  children,
}: {
  label: ReactNode;
  value?: string;
  copyable?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="setup-onboard-fields__row flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5"
      role="listitem"
    >
      <span className="setup-onboard-fields__label text-xs text-muted">{label}</span>
      <span className="setup-onboard-fields__value flex min-w-0 items-center gap-1">
        {children ?? (
          <>
            <code className="break-all font-mono text-[12px] text-ink">{value}</code>
            {copyable && value !== undefined ? <CopyButton text={value} /> : null}
          </>
        )}
      </span>
    </div>
  );
}

/** Value cell for a masked key: the key, its eye toggle and a copy button. */
export function KeyValue({
  shown,
  copyText,
  canReveal,
  revealed,
  onToggle,
}: {
  shown: string;
  copyText: string;
  canReveal: boolean;
  revealed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <code className="break-all font-mono text-[12px] text-ink">{shown}</code>
      {canReveal ? <RevealButton revealed={revealed} onToggle={onToggle} /> : null}
      <CopyButton text={copyText} />
    </>
  );
}

export interface SegmentItem<K extends string> {
  key: K;
  label: ReactNode;
}

/** Two-or-three-way switch rendered as tabs (`.segmented`). */
export function SetupSegment<K extends string>({
  items,
  value,
  onChange,
  label,
  full,
}: {
  items: SegmentItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  full?: boolean;
}) {
  return (
    <div className={cx('segmented', full && 'flex w-full')} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={value === item.key}
          className={cx(full && 'flex-1', value === item.key && 'is-active')}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
