import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageWake } from '../../src/lib/use-page-wake';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

afterEach(() => setVisibility('visible'));

describe('usePageWake', () => {
  it('calls onWake when the tab becomes visible again', () => {
    const onWake = vi.fn();
    renderHook(() => usePageWake(true, onWake));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('does not call onWake when the tab becomes hidden', () => {
    const onWake = vi.fn();
    renderHook(() => usePageWake(true, onWake));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onWake).not.toHaveBeenCalled();
  });

  it('calls onWake when the window is focused while visible, not while hidden', () => {
    const onWake = vi.fn();
    renderHook(() => usePageWake(true, onWake));
    window.dispatchEvent(new Event('focus'));
    expect(onWake).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    window.dispatchEvent(new Event('focus'));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('listens to nothing while disabled', () => {
    const onWake = vi.fn();
    renderHook(() => usePageWake(false, onWake));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(onWake).not.toHaveBeenCalled();
  });

  it('starts and stops listening as `enabled` flips', () => {
    const onWake = vi.fn();
    const { rerender } = renderHook(({ on }) => usePageWake(on, onWake), {
      initialProps: { on: false },
    });
    window.dispatchEvent(new Event('focus'));
    expect(onWake).not.toHaveBeenCalled();
    rerender({ on: true });
    window.dispatchEvent(new Event('focus'));
    expect(onWake).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    window.dispatchEvent(new Event('focus'));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest callback without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    const { rerender } = renderHook(({ cb }) => usePageWake(true, cb), {
      initialProps: { cb: first },
    });
    const focusSubscriptions = add.mock.calls.filter(([type]) => type === 'focus').length;
    rerender({ cb: second });
    expect(add.mock.calls.filter(([type]) => type === 'focus').length).toBe(focusSubscriptions);
    window.dispatchEvent(new Event('focus'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });

  it('removes its listeners on unmount', () => {
    const onWake = vi.fn();
    const { unmount } = renderHook(() => usePageWake(true, onWake));
    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(onWake).not.toHaveBeenCalled();
  });
});
