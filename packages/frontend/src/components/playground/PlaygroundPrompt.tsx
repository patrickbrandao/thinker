import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ArrowUp } from 'lucide-react';
import { cx } from '../ui.jsx';
import { t } from '../../i18n/index.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onRecallPrevious: () => void;
  disabled: boolean;
  running: boolean;
  headersSlot?: ReactNode;
  historyOpen?: boolean;
  onHeightChange?: (height: number) => void;
  ref?: (el: HTMLTextAreaElement) => void;
}

const MAX_PROMPT_LINES = 15;
const PROMPT_LINE_HEIGHT_PX = 22;

/** The prompt box pinned under the comparison columns. */
export default function PlaygroundPrompt({
  value,
  onChange,
  onSubmit,
  onRecallPrevious,
  disabled,
  running,
  headersSlot,
  historyOpen,
  onHeightChange,
  ref,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const forwardRef = useRef(ref);
  forwardRef.current = ref;
  const heightRef = useRef(onHeightChange);
  heightRef.current = onHeightChange;
  const observeHeight = !!onHeightChange;

  useEffect(() => {
    if (!observeHeight || !wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) heightRef.current?.(entry.contentRect.height);
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [observeHeight]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_PROMPT_LINES * PROMPT_LINE_HEIGHT_PX)}px`;
  }, []);

  // Recalled / history-loaded prompts set `value` programmatically without an
  // input event, so resize whenever the value changes.
  useLayoutEffect(() => {
    autoGrow();
  }, [value, autoGrow]);

  // Stable callback ref: hands the textarea to the parent once on mount.
  const setTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (el) forwardRef.current?.(el);
  }, []);

  const submit = () => {
    if (disabled || running) return;
    if (value.trim().length === 0) return;
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as globalThis.KeyboardEvent;
    const composing = native.isComposing || event.keyCode === 229;
    if (composing) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'ArrowUp' && value.length === 0) {
      event.preventDefault();
      onRecallPrevious();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={cx(
        'playground-prompt-wrapper',
        historyOpen && 'playground-prompt-wrapper--history-open',
      )}
    >
      <form
        className="playground-prompt rounded-surface border border-line-strong bg-elev focus-within:border-accent"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={setTextarea}
          className="playground-prompt__textarea block w-full resize-none bg-transparent px-3.5 pt-3 text-sm leading-[22px] text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
          placeholder={t('playground.prompt.placeholder')}
          value={value}
          rows={1}
          disabled={disabled && !running}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          aria-label={t('playground.prompt.label')}
        />
        <div className="playground-prompt__toolbar flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="playground-prompt__toolbar-left flex items-center gap-1">
            {headersSlot}
          </div>
          <button
            type="submit"
            className="playground-prompt__send inline-flex h-8 w-8 items-center justify-center rounded-control bg-accent text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disabled || value.trim().length === 0}
            aria-label={running ? t('playground.prompt.running') : t('playground.prompt.send')}
          >
            {running ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <ArrowUp size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
