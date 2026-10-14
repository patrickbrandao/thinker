import {
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import { useFocusTrap } from '../../services/use-focus-trap.js';
import {
  MAX_HEADER_ENTRIES,
  blankEntry,
  headerEntryIssues,
  type HeaderEntry,
  type HeaderIssue,
} from '../../services/playground-request-headers.js';
import { PlusIcon, TrashIcon, XIcon } from './icons.jsx';

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
  switch (issue) {
    case 'blocked':
      return `${name} is reserved by Thinker and will be dropped.`;
    case 'invalid-name':
      return `${name} is not a valid header name and will be dropped. Use only letters, digits and ! # $ % & ' * + - . ^ _ \` | ~ (no spaces).`;
    case 'control-chars':
      return `The value of ${name} contains control characters (such as line breaks), so the header will be dropped.`;
    case 'unsupported-chars':
      return `The value of ${name} contains characters a header can't carry (above U+00FF, such as emoji), so the header will be dropped.`;
    case 'duplicate':
      return `${name} is already set in an earlier row (names are case-insensitive), so this row will be dropped.`;
    case 'over-limit':
      return `Only ${MAX_HEADER_ENTRIES} headers are sent, so ${name} will be dropped.`;
  }
}

const RequestHeadersPopover: Component<Props> = (props) => {
  const [panelRef, setPanelRef] = createSignal<HTMLElement | undefined>();

  createEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  useFocusTrap(
    () => props.open,
    () => panelRef(),
  );

  // Screen-reader announcement for warnings that appear while typing. Only a
  // row whose issue *changes* to a new problem is announced, so typing more
  // characters into an already-invalid name doesn't repeat the message. The
  // first pass (opening with existing rows) is silent: the warning is still
  // reachable through each input's aria-describedby.
  const [announcement, setAnnouncement] = createSignal('');
  const issues = createMemo(() => headerEntryIssues(props.entries));
  let previousIssues: Map<string, HeaderIssue | null> | undefined;
  createEffect(() => {
    // Closed: forget the last message so reopening doesn't replay a stale one.
    if (!props.open) {
      setAnnouncement('');
      previousIssues = undefined;
      return;
    }
    const next = new Map<string, HeaderIssue | null>();
    const current = issues();
    let message = '';
    let anyIssue = false;
    for (const e of props.entries) {
      const issue = current.get(e.id) ?? null;
      next.set(e.id, issue);
      if (!issue) continue;
      anyIssue = true;
      if (previousIssues && !message && previousIssues.get(e.id) !== issue) {
        message = headerIssueMessage(e.key.trim(), issue);
      }
    }
    if (message) setAnnouncement(message);
    else if (!anyIssue) setAnnouncement('');
    previousIssues = next;
  });

  const update = (id: string, patch: Partial<HeaderEntry>) => {
    props.onChange(props.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const remove = (id: string) => {
    props.onChange(props.entries.filter((e) => e.id !== id));
  };
  const add = () => {
    props.onChange([...props.entries, blankEntry()]);
  };
  const clearAll = () => props.onChange([]);

  return (
    <Show when={props.open}>
      <div class="playground-headers__backdrop" role="presentation" onClick={props.onClose} />
      <div
        ref={setPanelRef}
        class="playground-headers"
        role="dialog"
        aria-modal="true"
        aria-label="Request headers"
      >
        <header class="playground-headers__header">
          <h3 class="playground-headers__title">Request headers</h3>
          <button
            type="button"
            class="playground-headers__close"
            aria-label="Close request headers"
            onClick={props.onClose}
          >
            <XIcon size={16} />
          </button>
        </header>

        <p class="playground-headers__hint">
          Added to every provider call for this playground. Thinker-managed headers (Authorization,
          Content-Type, x-thinker-*) are ignored, and so is any header the route's provider adapter
          sets itself. Only header names are saved in this browser; values are kept until you leave
          the page.
        </p>

        <Show when={props.entries.length === 0}>
          <p class="playground-headers__empty">No headers yet.</p>
        </Show>

        <div class="playground-headers__rows">
          {/* Index (not For): rows are updated immutably, and For would
              recreate the row on every keystroke, dropping input focus. */}
          <Index each={props.entries}>
            {(entry) => {
              const issue = () => issues().get(entry().id) ?? null;
              const nameIssue = () => {
                const i = issue();
                return i !== null && i !== 'control-chars' && i !== 'unsupported-chars';
              };
              const valueIssue = () =>
                issue() === 'control-chars' || issue() === 'unsupported-chars';
              const warningId = () => headerWarningId(entry().id);
              return (
                <div
                  class="playground-headers__row"
                  classList={{
                    'playground-headers__row--blocked': issue() === 'blocked',
                    'playground-headers__row--invalid-name':
                      issue() === 'invalid-name' ||
                      issue() === 'duplicate' ||
                      issue() === 'over-limit',
                    'playground-headers__row--invalid-value': valueIssue(),
                  }}
                >
                  <input
                    type="text"
                    class="playground-headers__input playground-headers__input--key"
                    placeholder="Header"
                    value={entry().key}
                    aria-label="Header name"
                    aria-invalid={nameIssue() ? 'true' : undefined}
                    aria-describedby={nameIssue() ? warningId() : undefined}
                    spellcheck={false}
                    autocomplete="off"
                    onInput={(e) => update(entry().id, { key: e.currentTarget.value })}
                  />
                  <input
                    type="text"
                    class="playground-headers__input playground-headers__input--value"
                    placeholder="Value"
                    value={entry().value}
                    aria-label="Header value"
                    aria-invalid={valueIssue() ? 'true' : undefined}
                    aria-describedby={valueIssue() ? warningId() : undefined}
                    spellcheck={false}
                    autocomplete="off"
                    onInput={(e) => update(entry().id, { value: e.currentTarget.value })}
                  />
                  <button
                    type="button"
                    class="playground-headers__remove"
                    aria-label={`Remove ${entry().key || 'header'}`}
                    onClick={() => remove(entry().id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                  <Show when={issue()}>
                    {(current) => (
                      <p id={warningId()} class="playground-headers__warning">
                        {headerIssueMessage(entry().key.trim(), current())}
                      </p>
                    )}
                  </Show>
                </div>
              );
            }}
          </Index>
        </div>

        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement()}
        </div>

        <footer class="playground-headers__footer">
          <button type="button" class="playground-headers__add" onClick={add}>
            <PlusIcon size={14} /> Add header
          </button>
          <Show when={props.entries.length > 0}>
            <button type="button" class="playground-headers__clear" onClick={clearAll}>
              Clear all
            </button>
          </Show>
        </footer>
      </div>
    </Show>
  );
};

export default RequestHeadersPopover;
