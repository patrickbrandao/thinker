import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import MultiSelect from '../../src/components/MultiSelect';

const OPTIONS = [
  {
    label: 'Anthropic',
    value: 'anthropic',
    description: 'Claude models',
    icon: <span data-testid="anthropic-icon">A</span>,
  },
  { label: 'OpenAI', value: 'openai' },
];

function renderMultiSelect(initialValues: string[] = [], label?: string) {
  const onChange = vi.fn();
  function Host() {
    const [values, setValues] = useState(initialValues);
    return (
      <MultiSelect
        options={OPTIONS}
        values={values}
        onChange={(next) => {
          onChange(next);
          setValues(next);
        }}
        placeholder="All providers"
        label={label}
      />
    );
  }
  const result = render(<Host />);
  return { ...result, onChange };
}

function openDropdown(name: string | RegExp = 'All providers') {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('MultiSelect', () => {
  it('opens with the empty selection, option metadata, and optional accessible label', () => {
    renderMultiSelect([], 'Provider filter');

    const trigger = screen.getByRole('button', { name: 'Provider filter' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('All providers')).toBeDefined();

    openDropdown('Provider filter');

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    expect(screen.getByTestId('anthropic-icon')).toBeDefined();
    expect(screen.getByText('Claude models')).toBeDefined();
    expect(
      screen.getByRole('option', { name: 'All providers' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('adds and removes values while keeping the dropdown open', () => {
    const { onChange } = renderMultiSelect();
    openDropdown();

    fireEvent.click(screen.getByRole('option', { name: /Anthropic/ }));
    expect(onChange).toHaveBeenLastCalledWith(['anthropic']);
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeDefined();
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.click(screen.getByRole('option', { name: 'OpenAI' }));
    expect(onChange).toHaveBeenLastCalledWith(['anthropic', 'openai']);
    expect(screen.getByText('2 selected')).toBeDefined();

    fireEvent.click(screen.getByRole('option', { name: /Anthropic/ }));
    expect(onChange).toHaveBeenLastCalledWith(['openai']);
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeDefined();
  });

  it('clears the selection from the all option', async () => {
    const { onChange } = renderMultiSelect(['anthropic']);
    openDropdown('Anthropic');

    fireEvent.click(screen.getByRole('option', { name: 'All providers' }));

    expect(onChange).toHaveBeenLastCalledWith([]);
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'All providers' }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
  });

  it('falls back to the placeholder for an unknown selected value', () => {
    renderMultiSelect(['missing']);
    expect(screen.getByText('All providers')).toBeDefined();
  });

  it('closes on outside click and Escape, but not on an option click', () => {
    renderMultiSelect();
    openDropdown();
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI' }));
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.click(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();

    openDropdown('OpenAI');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('removes its document listeners on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderMultiSelect();
    unmount();

    const removedEvents = removeSpy.mock.calls.map(([event]) => event);
    expect(removedEvents).toContain('click');
    expect(removedEvents).toContain('keydown');
    removeSpy.mockRestore();
  });
});

describe('MultiSelect with options derived from the selection', () => {
  // The Requests log builds its model options from the selection itself (so a
  // picked model stays listed even when it drops out of the range window).
  // Toggling then rebuilds the option nodes, and the clicked node may already
  // be detached when the document-level outside-click handler runs — contains()
  // says false and the menu used to close after a single pick.
  function SelfDerived() {
    const [values, setValues] = useState<string[]>([]);
    const options = [...new Set(['gpt-4o', 'claude-sonnet-4', ...values])].sort().map((value) => ({
      label: value,
      value,
    }));
    return (
      <MultiSelect
        options={options}
        values={values}
        onChange={setValues}
        placeholder="All models"
        label="Model filter"
      />
    );
  }

  it('stays open after picking an option when the options rebuild', async () => {
    render(<SelfDerived />);
    fireEvent.click(screen.getByRole('button', { name: 'Model filter' }));
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.click(screen.getByRole('option', { name: /gpt-4o/ }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /gpt-4o/ }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  it('closes when an outside element removes itself on click', async () => {
    // The detached-node guard must not swallow this: the click came from
    // outside, it merely left no node behind to ask `contains` about.
    function SelfRemoving() {
      const [present, setPresent] = useState(true);
      return present ? (
        <button data-testid="self-removing" onClick={() => setPresent(false)}>
          dismiss
        </button>
      ) : null;
    }
    render(<SelfRemoving />);
    render(<SelfDerived />);
    fireEvent.click(screen.getByRole('button', { name: 'Model filter' }));
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.click(screen.getByTestId('self-removing'));

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  it('still closes on a click outside the dropdown', async () => {
    render(<SelfDerived />);
    fireEvent.click(screen.getByRole('button', { name: 'Model filter' }));
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });
});
