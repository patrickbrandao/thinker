import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../../src/services/model-display.js', () => ({
  getModelDisplayName: (slug: string) => slug,
}));

vi.mock('../../src/services/routing-utils.js', () => ({
  resolveProviderId: (provider: string) => {
    const map: Record<string, string> = { OpenAI: 'openai', Anthropic: 'anthropic' };
    return map[provider] ?? null;
  },
}));

vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: (id: string, size: number) => <svg data-provider={id} width={size} height={size} />,
  customProviderLogo: () => null,
}));

import ModelPricesFilterBar from '../../src/components/ModelPricesFilterBar';

describe('ModelPricesFilterBar', () => {
  const baseProps = {
    allModels: ['gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet'],
    allProviders: ['OpenAI', 'Anthropic', 'UnknownProvider'],
    selectedModels: new Set<string>(),
    selectedProviders: new Set<string>(),
    onAddModel: vi.fn(),
    onRemoveModel: vi.fn(),
    onAddProvider: vi.fn(),
    onRemoveProvider: vi.fn(),
    onClearFilters: vi.fn(),
    totalCount: 3,
    filteredCount: 3,
  };

  const search = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>('.model-filter__search')!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input with combobox role', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    const input = container.querySelector('.model-filter__search');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('role')).toBe('combobox');
  });

  it('shows total count when no filters active', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    expect(container.textContent).toContain('3 models');
  });

  it('shows dropdown when typing 2+ characters', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    fireEvent.change(search(container), { target: { value: 'gpt' } });
    expect(container.querySelector('.model-filter__dropdown')).not.toBeNull();
  });

  it('navigates dropdown with ArrowUp key', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    const input = search(container);
    fireEvent.change(input, { target: { value: 'gpt' } });
    // ArrowDown twice, then ArrowUp
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const highlighted = container.querySelector('.model-filter__dropdown-item--highlighted');
    expect(highlighted).not.toBeNull();
  });

  it('selects suggestion with Enter key', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    const input = search(container);
    fireEvent.change(input, { target: { value: 'gpt' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(baseProps.onAddModel).toHaveBeenCalledWith('gpt-4o');
  });

  it('does nothing on Enter without highlighted item', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    const input = search(container);
    fireEvent.change(input, { target: { value: 'gpt' } });
    // Don't ArrowDown, just Enter
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(baseProps.onAddModel).not.toHaveBeenCalled();
  });

  it('shows fallback SVG icon for unknown provider', () => {
    const propsWithUnknown = {
      ...baseProps,
      selectedProviders: new Set(['UnknownProvider']),
    };
    const { container } = render(<ModelPricesFilterBar {...propsWithUnknown} />);
    // The unknown provider tag should show the fallback SVG
    const tags = container.querySelectorAll('.model-filter__tag');
    expect(tags.length).toBe(1);
    // The fallback SVG has a rect element
    expect(tags[0]!.querySelector('svg rect')).not.toBeNull();
  });

  it('shows provider icon for known provider in tag', () => {
    const propsWithKnown = {
      ...baseProps,
      selectedProviders: new Set(['OpenAI']),
    };
    const { container } = render(<ModelPricesFilterBar {...propsWithKnown} />);
    const tags = container.querySelectorAll('.model-filter__tag');
    expect(tags.length).toBe(1);
    // The known provider tag should use providerIcon (mocked as svg with data-provider)
    expect(tags[0]!.querySelector("svg[data-provider='openai']")).not.toBeNull();
  });

  it('calls onRemoveModel when model tag remove button clicked', () => {
    const propsWithModel = {
      ...baseProps,
      selectedModels: new Set(['gpt-4o']),
    };
    const { container } = render(<ModelPricesFilterBar {...propsWithModel} />);
    fireEvent.click(container.querySelector('.model-filter__tag-remove')!);
    expect(baseProps.onRemoveModel).toHaveBeenCalledWith('gpt-4o');
  });

  it('calls onRemoveProvider when provider tag remove button clicked', () => {
    const propsWithProvider = {
      ...baseProps,
      selectedProviders: new Set(['OpenAI']),
    };
    const { container } = render(<ModelPricesFilterBar {...propsWithProvider} />);
    fireEvent.click(container.querySelector('.model-filter__tag-remove')!);
    expect(baseProps.onRemoveProvider).toHaveBeenCalledWith('OpenAI');
  });

  it('opens dropdown with ArrowDown when closed but query has 2+ chars', () => {
    const { container } = render(<ModelPricesFilterBar {...baseProps} />);
    const input = search(container);
    fireEvent.change(input, { target: { value: 'gpt' } });
    // Close it with Escape
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('.model-filter__dropdown')).toBeNull();
    // Reopen with ArrowDown
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(container.querySelector('.model-filter__dropdown')).not.toBeNull();
  });

  it('shows filtered count and Clear filters when filters active', () => {
    const propsFiltered = {
      ...baseProps,
      selectedProviders: new Set(['OpenAI']),
      filteredCount: 2,
    };
    const { container } = render(<ModelPricesFilterBar {...propsFiltered} />);
    expect(container.textContent).toContain('2 of 3 models');
    expect(container.textContent).toContain('Clear filters');
  });

  it('calls onClearFilters and resets query on Clear filters click', () => {
    const propsFiltered = {
      ...baseProps,
      selectedProviders: new Set(['OpenAI']),
      filteredCount: 2,
    };
    const { container } = render(<ModelPricesFilterBar {...propsFiltered} />);
    fireEvent.change(search(container), { target: { value: 'gp' } });
    fireEvent.click(container.querySelector('.model-filter__clear-all')!);
    expect(baseProps.onClearFilters).toHaveBeenCalled();
    expect(search(container).value).toBe('');
  });

  it('removes last tag on Backspace when input is empty', () => {
    const propsWithTag = {
      ...baseProps,
      selectedModels: new Set(['gpt-4o']),
    };
    const { container } = render(<ModelPricesFilterBar {...propsWithTag} />);
    fireEvent.keyDown(search(container), { key: 'Backspace' });
    expect(baseProps.onRemoveModel).toHaveBeenCalledWith('gpt-4o');
  });
});
