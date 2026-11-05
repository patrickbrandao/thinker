import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { RightSidebarProvider, useRightSidebar } from '../../src/services/right-sidebar';

describe('right sidebar', () => {
  it('throws a clear error when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useRightSidebar())).toThrow(
      'useRightSidebar must be used inside RightSidebarProvider',
    );
    spy.mockRestore();
  });

  it('starts empty and lets a page dock and clear its panel', () => {
    const { result } = renderHook(() => useRightSidebar(), { wrapper: RightSidebarProvider });
    expect(result.current.content).toBeNull();
    act(() => result.current.setContent(<p>panel</p>));
    expect(result.current.content).not.toBeNull();
    act(() => result.current.setContent(null));
    expect(result.current.content).toBeNull();
  });

  it('shares one state between a page and the shell', () => {
    function Page() {
      const { setContent } = useRightSidebar();
      return <button onClick={() => setContent(<aside>docked</aside>)}>dock</button>;
    }
    function Shell() {
      const { content } = useRightSidebar();
      return <div data-testid="slot">{content}</div>;
    }
    render(
      <RightSidebarProvider>
        <Page />
        <Shell />
      </RightSidebarProvider>,
    );
    expect(screen.getByTestId('slot').textContent).toBe('');
    act(() => screen.getByRole('button', { name: 'dock' }).click());
    expect(screen.getByTestId('slot').textContent).toBe('docked');
  });
});
