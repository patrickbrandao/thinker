import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import RequestHeadersPopover, {
  headerIssueMessage,
} from '../../src/components/playground/RequestHeadersPopover';
import { blankEntry, type HeaderEntry } from '../../src/services/playground-request-headers';

describe('RequestHeadersPopover', () => {
  it('renders nothing when closed', () => {
    const { container } = render(() => (
      <RequestHeadersPopover open={false} entries={[]} onChange={() => {}} onClose={() => {}} />
    ));
    expect(container.querySelector('.playground-headers')).toBeNull();
  });

  it('adds a new blank row when "Add header" is clicked', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([blankEntry()]);
    const { getByText } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    expect(entries().length).toBe(1);
    fireEvent.click(getByText('Add header'));
    expect(entries().length).toBe(2);
  });

  it('shows an inline warning when the user types a Thinker-managed key', () => {
    const initial: HeaderEntry = { id: '1', key: 'Authorization', value: 'Bearer x' };
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[initial]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    expect(container.querySelector('.playground-headers__warning')?.textContent).toContain(
      'Authorization',
    );
    expect(container.querySelector('.playground-headers__row--blocked')).not.toBeNull();
    const key = container.querySelector('.playground-headers__input--key');
    expect(key?.getAttribute('aria-invalid')).toBe('true');
  });

  // Issue #105: the server drops invalid names silently; the dashboard warns.
  it('warns when the header name is not a valid HTTP token', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: '1', key: 'X Title', value: 'v' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    expect(container.querySelector('.playground-headers__warning')?.textContent).toBe(
      headerIssueMessage('X Title', 'invalid-name'),
    );
    expect(container.querySelector('.playground-headers__row--invalid-name')).not.toBeNull();
    expect(container.querySelector('.playground-headers__row--blocked')).toBeNull();
    const key = container.querySelector('.playground-headers__input--key');
    expect(key?.getAttribute('aria-invalid')).toBe('true');
  });

  it('warns when the value contains control characters', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: '1', key: 'X-Title', value: 'line\u0001break' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    const warning = container.querySelector('.playground-headers__warning')?.textContent;
    expect(warning).toContain('X-Title');
    expect(warning).toContain('control characters');
    expect(container.querySelector('.playground-headers__row--invalid-value')).not.toBeNull();
    const value = container.querySelector('.playground-headers__input--value');
    expect(value?.getAttribute('aria-invalid')).toBe('true');
    const key = container.querySelector('.playground-headers__input--key');
    expect(key?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('warns when the value contains characters above U+00FF', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: '1', key: 'X-Title', value: 'rocket \u{1F680}' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    expect(container.querySelector('.playground-headers__warning')?.textContent).toBe(
      headerIssueMessage('X-Title', 'unsupported-chars'),
    );
  });

  it('shows no warning for a valid header or a fresh blank row', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: '1', key: 'X-Title', value: 'caf\u00e9' }, blankEntry()]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    expect(container.querySelector('.playground-headers__warning')).toBeNull();
    expect(container.querySelector('[aria-invalid]')).toBeNull();
  });

  it('warns while typing: the warning appears once the name becomes invalid', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'r1', key: 'X-Title', value: 'a' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    expect(container.querySelector('.playground-headers__warning')).toBeNull();
    const keyInput = container.querySelector('.playground-headers__input--key') as HTMLInputElement;
    fireEvent.input(keyInput, { target: { value: 'X-Title:' } });
    expect(container.querySelector('.playground-headers__warning')?.textContent).toContain(
      'not a valid header name',
    );
  });

  it('tells the user that header values are not saved', () => {
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={() => {}} />
    ));
    const hint = container.querySelector('.playground-headers__hint')?.textContent ?? '';
    expect(hint).toContain('Only header names are saved');
    expect(hint).toContain('x-thinker-*');
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={onClose} />
    ));
    const backdrop = container.querySelector('.playground-headers__backdrop');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the dialog with aria-modal="true" so screen readers know focus is trapped', () => {
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={() => {}} />
    ));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeDefined();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('calls onClose when Escape is pressed at the window', () => {
    const onClose = vi.fn();
    render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={onClose} />
    ));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('removes a row when its trash button is clicked', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'r1', key: 'X-Title', value: 'a' },
      { id: 'r2', key: 'HTTP-Referer', value: 'b' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const remove = container.querySelector('.playground-headers__remove') as HTMLElement;
    fireEvent.click(remove);
    expect(entries()).toHaveLength(1);
  });

  it('clears all entries via the Clear-all button', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'r1', key: 'X-Title', value: 'a' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const clear = container.querySelector('.playground-headers__clear') as HTMLElement;
    fireEvent.click(clear);
    expect(entries()).toEqual([]);
  });

  it('forwards key edits via onChange and only mutates the matching row', () => {
    // Two rows; editing the FIRST row's key must leave the second untouched.
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'r1', key: 'X-Title', value: 'a' },
      { id: 'r2', key: 'HTTP-Referer', value: 'b' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const keyInputs = container.querySelectorAll(
      '.playground-headers__input--key',
    ) as NodeListOf<HTMLInputElement>;
    fireEvent.input(keyInputs[0]!, { target: { value: 'X-Other' } });
    expect(entries()[0]!.key).toBe('X-Other');
    expect(entries()[1]!.key).toBe('HTTP-Referer');
  });

  it('forwards value edits via onChange', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'r1', key: 'X-Title', value: 'a' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const valueInput = container.querySelector(
      '.playground-headers__input--value',
    ) as HTMLInputElement;
    fireEvent.input(valueInput, { target: { value: 'newval' } });
    expect(entries()[0]!.value).toBe('newval');
  });

  it('shows an "empty" hint when no entries are present', () => {
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={() => {}} />
    ));
    expect(container.textContent).toContain('No headers yet');
  });

  it('fires onClose via the explicit close button as well', () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={onClose} />
    ));
    const close = container.querySelector('[aria-label="Close request headers"]') as HTMLElement;
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });
});
