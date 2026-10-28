import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoutingTabs from '../../src/components/RoutingTabs';

function renderTabs(
  overrides: Partial<{ specificityEnabled: boolean; showSpecificity: boolean }> = {},
) {
  return render(
    <RoutingTabs
      specificityEnabled={overrides.specificityEnabled ?? false}
      showSpecificity={overrides.showSpecificity}
    >
      {{
        default: <div data-testid="default-content">Default content</div>,
        specificity: <div data-testid="specificity-content">Specificity content</div>,
      }}
    </RoutingTabs>,
  );
}

describe('RoutingTabs', () => {
  it('renders the Default and Task-specific tabs', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: /Default/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Task-specific/ })).toBeDefined();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('renders tablist with aria-label', () => {
    renderTabs();
    expect(screen.getByRole('tablist', { name: 'Routing layers' })).toBeDefined();
  });

  it('hides the Task-specific tab when showSpecificity is false', () => {
    renderTabs({ showSpecificity: false });
    expect(screen.queryByRole('tab', { name: /Task-specific/ })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('shows the default panel first and switches to task-specific on click', () => {
    renderTabs();
    expect(screen.getByTestId('default-content')).toBeDefined();
    expect(screen.queryByTestId('specificity-content')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Task-specific/ }));
    expect(screen.getByTestId('specificity-content')).toBeDefined();
    expect(screen.queryByTestId('default-content')).toBeNull();
  });

  it('shows green dot for enabled layers and gray for disabled', () => {
    const { container, rerender } = renderTabs();
    expect(container.querySelectorAll('.routing-tabs__dot--on')).toHaveLength(1);
    expect(container.querySelectorAll('.routing-tabs__dot--off')).toHaveLength(1);
    rerender(
      <RoutingTabs specificityEnabled>{{ default: <div />, specificity: <div /> }}</RoutingTabs>,
    );
    expect(container.querySelectorAll('.routing-tabs__dot--on')).toHaveLength(2);
  });

  it('renders headerRight slot only when provided', () => {
    const { container, rerender } = render(
      <RoutingTabs specificityEnabled={false} headerRight={<div data-testid="right">R</div>}>
        {{ default: <div />, specificity: <div /> }}
      </RoutingTabs>,
    );
    expect(screen.getByTestId('right')).toBeDefined();
    rerender(
      <RoutingTabs specificityEnabled={false}>
        {{ default: <div />, specificity: <div /> }}
      </RoutingTabs>,
    );
    expect(container.querySelector('.routing-tabs__header-right')).toBeNull();
  });
});
