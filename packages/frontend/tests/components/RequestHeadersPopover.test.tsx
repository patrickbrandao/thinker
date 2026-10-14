import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import RequestHeadersPopover, {
  headerIssueMessage,
  headerWarningId,
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
    expect(container.querySelector('[aria-describedby]')).toBeNull();
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

  // Review S1 on #106: screen readers must hear why a field is invalid.
  it('links the invalid name input to its warning with aria-describedby', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: 'row-1', key: 'X Title', value: 'v' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    const key = container.querySelector('.playground-headers__input--key')!;
    const value = container.querySelector('.playground-headers__input--value')!;
    expect(key.getAttribute('aria-describedby')).toBe(headerWarningId('row-1'));
    expect(value.hasAttribute('aria-describedby')).toBe(false);
    const warning = document.getElementById(headerWarningId('row-1'));
    expect(warning?.classList.contains('playground-headers__warning')).toBe(true);
    expect(warning?.textContent).toBe(headerIssueMessage('X Title', 'invalid-name'));
  });

  it('links a blocked name to its warning', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: 'row-2', key: 'Authorization', value: 'x' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    const key = container.querySelector('.playground-headers__input--key')!;
    expect(key.getAttribute('aria-describedby')).toBe(headerWarningId('row-2'));
    expect(document.getElementById(headerWarningId('row-2'))?.textContent).toContain(
      'reserved by Thinker',
    );
  });

  it('links the invalid value input to its warning with aria-describedby', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: 'row-3', key: 'X-Title', value: 'a\nb' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    const key = container.querySelector('.playground-headers__input--key')!;
    const value = container.querySelector('.playground-headers__input--value')!;
    expect(value.getAttribute('aria-describedby')).toBe(headerWarningId('row-3'));
    expect(key.hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById(headerWarningId('row-3'))?.textContent).toBe(
      headerIssueMessage('X-Title', 'control-chars'),
    );
  });

  it('removes aria-describedby and the warning once the row is fixed', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'row-4', key: 'X Title', value: 'v' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const key = container.querySelector('.playground-headers__input--key') as HTMLInputElement;
    expect(key.getAttribute('aria-describedby')).toBe(headerWarningId('row-4'));
    fireEvent.input(key, { target: { value: 'X-Title' } });
    expect(key.hasAttribute('aria-describedby')).toBe(false);
    expect(key.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById(headerWarningId('row-4'))).toBeNull();
  });

  it('announces a warning once when it appears while typing, not on every keystroke', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'row-5', key: 'X', value: 'v' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const live = container.querySelector('[role="status"][aria-live="polite"]')!;
    expect(live.textContent).toBe('');
    const key = container.querySelector('.playground-headers__input--key') as HTMLInputElement;

    fireEvent.input(key, { target: { value: 'X:' } });
    expect(live.textContent).toBe(headerIssueMessage('X:', 'invalid-name'));

    // Still the same problem: the live region is not rewritten (no re-announce).
    fireEvent.input(key, { target: { value: 'X:T' } });
    expect(live.textContent).toBe(headerIssueMessage('X:', 'invalid-name'));

    // A different problem on the same row is announced.
    fireEvent.input(key, { target: { value: 'Cookie' } });
    expect(live.textContent).toBe(headerIssueMessage('Cookie', 'blocked'));

    // Fixed: the region clears, so the same warning can be announced again later.
    fireEvent.input(key, { target: { value: 'X-Title' } });
    expect(live.textContent).toBe('');
  });

  it('does not announce warnings that already exist when the popover opens', () => {
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={[{ id: 'row-6', key: 'X Title', value: 'v' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('keeps the same input focused while typing', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'row-7', key: 'X', value: '' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    const before = container.querySelector('.playground-headers__input--key') as HTMLInputElement;
    before.focus();
    fireEvent.input(before, { target: { value: 'XY' } });
    const after = container.querySelector('.playground-headers__input--key');
    expect(after).toBe(before);
    expect(document.activeElement).toBe(before);
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

  it('clears the announcement on close, so reopening does not replay a stale warning', () => {
    const [open, setOpen] = createSignal(true);
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'row-7', key: 'X', value: 'v' },
    ]);
    const { container } = render(() => (
      <RequestHeadersPopover
        open={open()}
        entries={entries()}
        onChange={setEntries}
        onClose={() => setOpen(false)}
      />
    ));
    const key = container.querySelector('.playground-headers__input--key') as HTMLInputElement;
    fireEvent.input(key, { target: { value: 'X:' } });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      headerIssueMessage('X:', 'invalid-name'),
    );

    setOpen(false);
    setOpen(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
    // The warning itself is still shown on the row.
    expect(container.querySelector('.playground-headers__warning')?.textContent).toBe(
      headerIssueMessage('X:', 'invalid-name'),
    );
  });

  it('warns on a duplicate name and on rows past the 20-header cap', () => {
    const rows: HeaderEntry[] = [
      { id: 'd1', key: 'X-Title', value: 'a' },
      { id: 'd2', key: 'x-title', value: 'b' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, key: `X-H${i}`, value: 'v' })),
    ];
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={rows} onChange={() => {}} onClose={() => {}} />
    ));
    expect(document.getElementById(headerWarningId('d2'))?.textContent).toBe(
      headerIssueMessage('x-title', 'duplicate'),
    );
    expect(document.getElementById(headerWarningId('c19'))?.textContent).toBe(
      headerIssueMessage('X-H19', 'over-limit'),
    );
    expect(document.getElementById(headerWarningId('c18'))).toBeNull();
    expect(container.querySelectorAll('.playground-headers__warning')).toHaveLength(2);
    const dupKey = container.querySelectorAll('.playground-headers__input--key')[1]!;
    expect(dupKey.getAttribute('aria-invalid')).toBe('true');
    expect(dupKey.getAttribute('aria-describedby')).toBe(headerWarningId('d2'));
  });

  it('removes the middle row and keeps the others with their values', () => {
    const [entries, setEntries] = createSignal<HeaderEntry[]>([
      { id: 'm1', key: 'X-A', value: '1' },
      { id: 'm2', key: 'X-B', value: '2' },
      { id: 'm3', key: 'X-C', value: '3' },
    ]);
    const { container, getByLabelText } = render(() => (
      <RequestHeadersPopover
        open={true}
        entries={entries()}
        onChange={setEntries}
        onClose={() => {}}
      />
    ));
    fireEvent.click(getByLabelText('Remove X-B'));
    expect(entries().map((e) => e.id)).toEqual(['m1', 'm3']);
    const keys = [...container.querySelectorAll<HTMLInputElement>('.playground-headers__input--key')];
    const values = [
      ...container.querySelectorAll<HTMLInputElement>('.playground-headers__input--value'),
    ];
    expect(keys.map((k) => k.value)).toEqual(['X-A', 'X-C']);
    expect(values.map((v) => v.value)).toEqual(['1', '3']);
  });

  it('says headers set by the route adapter are ignored', () => {
    const { container } = render(() => (
      <RequestHeadersPopover open={true} entries={[]} onChange={() => {}} onClose={() => {}} />
    ));
    expect(container.querySelector('.playground-headers__hint')?.textContent).toContain(
      "any header the route's provider adapter sets itself",
    );
  });
});
