import { describe, it, expect } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import VirtualList from '../../src/components/VirtualList';

type Row = { id: string };
const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }));
const itemHeight = () => 20;

function list(items: Row[], resetKey?: unknown) {
  return (
    <VirtualList items={items} itemHeight={itemHeight} class="vl" resetKey={resetKey}>
      {(item) => <div data-testid={item.id}>{item.id}</div>}
    </VirtualList>
  );
}

describe('VirtualList', () => {
  it('does not mount items that sit far below the default viewport', () => {
    const { container } = render(list(rows(100)));

    expect(container.querySelector('[data-testid="row-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-99"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="row-"]').length).toBeLessThan(50);
  });

  it('mounts later items after the scroller moves down', () => {
    const { container } = render(list(rows(100)));
    const scroller = container.querySelector('.vl') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 1600 });
    fireEvent.scroll(scroller);

    expect(container.querySelector('[data-testid="row-80"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-0"]')).toBeNull();
  });

  it('renders every item when the catalog fits in the viewport', () => {
    const { container } = render(list(rows(3)));

    expect(container.querySelector('[data-testid="row-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-2"]')).not.toBeNull();
  });

  it('renders an empty spacer when there are no items', () => {
    const { container } = render(list([]));

    expect(container.querySelector('.vl')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="row-"]').length).toBe(0);
  });

  it('narrows the window after ResizeObserver reports a real scroller height', () => {
    const callbacks: ResizeObserverCallback[] = [];
    class FakeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;

    try {
      const { container, unmount } = render(list(rows(100)));
      const scroller = container.querySelector('.vl') as HTMLElement;
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 80 });
      act(() => callbacks[0]?.([], {} as ResizeObserver));

      expect(container.querySelector('[data-testid="row-0"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="row-20"]')).toBeNull();
      unmount();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('clamps the window when the list shrinks under the current scroll offset', () => {
    const { container, rerender } = render(list(rows(100)));
    const scroller = container.querySelector('.vl') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 1600,
    });
    fireEvent.scroll(scroller);
    rerender(list(rows(5)));

    expect(scroller.scrollTop).toBe(0);
    expect(container.querySelector('[data-testid="row-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-80"]')).toBeNull();
  });

  it('returns to the top when resetKey changes', () => {
    const items = rows(100);
    const { container, rerender } = render(list(items, 'all'));
    const scroller = container.querySelector('.vl') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 1600,
    });
    fireEvent.scroll(scroller);
    expect(container.querySelector('[data-testid="row-0"]')).toBeNull();

    rerender(list(items, 'filtered'));

    expect(container.querySelector('[data-testid="row-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-80"]')).toBeNull();
  });

  it('resets when resetKey goes from unset to a value', () => {
    const items = rows(100);
    const { container, rerender } = render(list(items, undefined));
    const scroller = container.querySelector('.vl') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 1600,
    });
    fireEvent.scroll(scroller);
    expect(container.querySelector('[data-testid="row-0"]')).toBeNull();

    rerender(list(items, 'now'));

    expect(scroller.scrollTop).toBe(0);
    expect(container.querySelector('[data-testid="row-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-80"]')).toBeNull();
  });

  it('keeps the scroll offset when the parent re-renders with the same resetKey', () => {
    const items = rows(100);
    const { container, rerender } = render(list(items, 'all'));
    const scroller = container.querySelector('.vl') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 1600,
    });
    fireEvent.scroll(scroller);

    rerender(list(items, 'all'));

    expect(container.querySelector('[data-testid="row-80"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-0"]')).toBeNull();
  });
});
