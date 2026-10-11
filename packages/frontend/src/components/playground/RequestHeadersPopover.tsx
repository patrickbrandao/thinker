import { For, Show, createEffect, createSignal, onCleanup, type Component } from 'solid-js';
import { useFocusTrap } from '../../services/use-focus-trap.js';
import {
  blankEntry,
  headerEntryIssue,
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
          Content-Type, x-thinker-*) are ignored. Only header names are saved in this browser;
          values are kept until you leave the page.
        </p>

        <Show when={props.entries.length === 0}>
          <p class="playground-headers__empty">No headers yet.</p>
        </Show>

        <div class="playground-headers__rows">
          <For each={props.entries}>
            {(entry) => {
              const issue = () => headerEntryIssue(entry);
              const nameIssue = () => issue() === 'blocked' || issue() === 'invalid-name';
              const valueIssue = () =>
                issue() === 'control-chars' || issue() === 'unsupported-chars';
              return (
                <div
                  class="playground-headers__row"
                  classList={{
                    'playground-headers__row--blocked': issue() === 'blocked',
                    'playground-headers__row--invalid-name': issue() === 'invalid-name',
                    'playground-headers__row--invalid-value': valueIssue(),
                  }}
                >
                  <input
                    type="text"
                    class="playground-headers__input playground-headers__input--key"
                    placeholder="Header"
                    value={entry.key}
                    aria-label="Header name"
                    aria-invalid={nameIssue() ? 'true' : undefined}
                    spellcheck={false}
                    autocomplete="off"
                    onInput={(e) => update(entry.id, { key: e.currentTarget.value })}
                  />
                  <input
                    type="text"
                    class="playground-headers__input playground-headers__input--value"
                    placeholder="Value"
                    value={entry.value}
                    aria-label="Header value"
                    aria-invalid={valueIssue() ? 'true' : undefined}
                    spellcheck={false}
                    autocomplete="off"
                    onInput={(e) => update(entry.id, { value: e.currentTarget.value })}
                  />
                  <button
                    type="button"
                    class="playground-headers__remove"
                    aria-label={`Remove ${entry.key || 'header'}`}
                    onClick={() => remove(entry.id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                  <Show when={issue()}>
                    {(current) => (
                      <p class="playground-headers__warning">
                        {headerIssueMessage(entry.key.trim(), current())}
                      </p>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
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
