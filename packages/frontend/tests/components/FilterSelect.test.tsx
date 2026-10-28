import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import FilterSelect from '../../src/components/FilterSelect';

const ITEMS = ['anthropic', 'gemini', 'openai'];
const COLORS: Record<string, string> = {
  anthropic: '#111111',
  gemini: '#222222',
  openai: '#333333',
};

function renderFilter(
  overrides: Partial<ComponentProps<typeof FilterSelect>> = {},
  selected: Set<string> = new Set(ITEMS),
) {
  const onToggle = vi.fn();
  const onSelectAll = vi.fn();
  const onUnselectAll = vi.fn();
  const result = render(
    <FilterSelect
      noun="providers"
      items={ITEMS}
      selected={selected}
      colorMap={COLORS}
      onToggle={onToggle}
      onSelectAll={onSelectAll}
      onUnselectAll={onUnselectAll}
      {...overrides}
    />,
  );
  return { ...result, onToggle, onSelectAll, onUnselectAll };
}

const openDropdown = () => {
  fireEvent.click(document.querySelector('.filter-select-trigger')!);
};

describe('FilterSelect', () => {
  it('shows the "all selected" trigger label', () => {
    renderFilter();
    expect(screen.getByText('All providers (3)')).toBeDefined();
  });

  it('shows the partial-selection trigger label', () => {
    renderFilter({}, new Set(['anthropic']));
    expect(screen.getByText('1 of 3 providers')).toBeDefined();
  });

  it('opens and closes the dropdown from the trigger', () => {
    renderFilter();
    expect(document.querySelector('.filter-select-menu')).toBeNull();
    openDropdown();
    expect(document.querySelector('.filter-select-menu')).not.toBeNull();
    openDropdown();
    expect(document.querySelector('.filter-select-menu')).toBeNull();
  });

  it('renders one row per item with swatch color and raw name by default', () => {
    renderFilter();
    openDropdown();
    const swatches = document.querySelectorAll('.filter-select-swatch');
    expect(swatches.length).toBe(3);
    expect((swatches[0] as HTMLElement).style.background).toBe('rgb(17, 17, 17)');
    expect(screen.getByText('anthropic')).toBeDefined();
  });

  it('uses the displayName resolver when provided', () => {
    renderFilter({ displayName: (item) => item.toUpperCase() });
    openDropdown();
    expect(screen.getByText('ANTHROPIC')).toBeDefined();
  });

  it('marks selected items as checked', () => {
    renderFilter({}, new Set(['anthropic']));
    openDropdown();
    const toggles = document.querySelectorAll('.filter-select-toggle');
    expect(toggles[0]!.getAttribute('aria-checked')).toBe('true');
    expect(toggles[1]!.getAttribute('aria-checked')).toBe('false');
    const rows = screen.getAllByRole('menuitemcheckbox');
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true');
    expect(rows[1]!.getAttribute('aria-checked')).toBe('false');
  });

  it('calls onToggle with the clicked item', () => {
    const { onToggle } = renderFilter();
    openDropdown();
    fireEvent.click(screen.getByText('gemini'));
    expect(onToggle).toHaveBeenCalledWith('gemini');
  });

  it('disables "Select all" when everything is selected and does not call onSelectAll', () => {
    const { onSelectAll } = renderFilter();
    openDropdown();
    const selectAll = screen.getByText('Select all') as HTMLButtonElement;
    expect(selectAll.disabled).toBe(true);
    fireEvent.click(selectAll);
    expect(onSelectAll).not.toHaveBeenCalled();
  });

  it('enables "Select all" when nothing is selected and calls onSelectAll', () => {
    const { onSelectAll } = renderFilter({}, new Set<string>());
    openDropdown();
    const selectAll = screen.getByText('Select all') as HTMLButtonElement;
    expect(selectAll.disabled).toBe(false);
    fireEvent.click(selectAll);
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('closes on outside click but stays open on inside click', () => {
    renderFilter();
    openDropdown();
    fireEvent.click(screen.getByText('anthropic'));
    expect(document.querySelector('.filter-select-menu')).not.toBeNull();
    fireEvent.click(document.body);
    expect(document.querySelector('.filter-select-menu')).toBeNull();
  });

  it('closes on Escape', () => {
    renderFilter();
    openDropdown();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.filter-select-menu')).toBeNull();
  });

  it('removes document listeners on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderFilter();
    unmount();
    const removed = removeSpy.mock.calls.map((c) => c[0]);
    expect(removed).toContain('click');
    expect(removed).toContain('keydown');
    removeSpy.mockRestore();
  });
});
