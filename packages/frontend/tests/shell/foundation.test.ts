import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { signal, useSignal } from '../../src/lib/signal';
import { useResource } from '../../src/lib/use-resource';
import { columnLayout, validEdges } from '../../src/components/flow/layout';
import { t, tMaybe, resetLocaleForTests } from '../../src/i18n';
import { NAVIGATION, activeNavItem } from '../../src/config/navigation';

describe('signal', () => {
  it('reads, writes and re-renders subscribers', () => {
    const count = signal(1);
    const { result } = renderHook(() => useSignal(count));
    expect(result.current).toBe(1);
    act(() => count.set((n) => n + 1));
    expect(result.current).toBe(2);
    expect(count()).toBe(2);
  });
});

describe('useResource', () => {
  it('drops a slow response that arrives after newer inputs', async () => {
    let resolveFirst: (v: string) => void = () => {};
    const fetcher = vi
      .fn<(key: string) => Promise<string>>()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockImplementationOnce(async () => 'second');
    const { result, rerender } = renderHook(({ k }) => useResource(() => fetcher(k), [k]), {
      initialProps: { k: 'a' },
    });
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.data).toBe('second'));
    act(() => resolveFirst('first'));
    await Promise.resolve();
    expect(result.current.data).toBe('second');
  });

  it('waits while disabled', () => {
    const fetcher = vi.fn(async () => 1);
    const { result } = renderHook(() => useResource(fetcher, [], { enabled: false }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});

describe('i18n', () => {
  it('fills placeholders, calls plural functions and switches language', () => {
    expect(t('shell.user.role', { role: 'admin' })).toBe('Your role: admin');
    expect(t('shell.alerts.labelUnseen', 3)).toBe('Alerts, 3 new');
    resetLocaleForTests('pt-BR');
    expect(t('nav.topology')).toBe('Topologia');
    expect(tMaybe('no.such.key')).toBeUndefined();
  });
});

describe('navigation', () => {
  it('marks the section of nested paths', () => {
    expect(activeNavItem('/providers/connections/abc')?.key).toBe('subscriptions');
    expect(activeNavItem('/harnesses/bot/routing')?.key).toBe('harnesses');
    expect(NAVIGATION.flatMap((g) => g.items.map((i) => i.key))).not.toContain('organization');
  });
});

describe('flow layout', () => {
  it('stacks each column, orders it by parents and keeps saved positions', () => {
    const node = (id: string) => ({
      id,
      type: 'node' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'node' as const, icon: null, title: id },
    });
    const column: Record<string, number> = { a: 0, b: 0, x: 1, y: 1, z: 2 };
    const graph = columnLayout(
      {
        nodes: [node('a'), node('b'), node('x'), node('y'), node('z')],
        edges: [
          { id: 'by', source: 'b', target: 'y' },
          { id: 'ax', source: 'a', target: 'x' },
          { id: 'xz', source: 'x', target: 'z' },
        ],
      },
      { columnOf: (n) => column[n.id]!, heightOf: () => 100, positions: { z: { x: 7, y: 9 } } },
    );
    const at = Object.fromEntries(graph.nodes.map((n) => [n.id, n.position]));
    expect(at.a!.x).toBeLessThan(at.x!.x);
    // y follows b, which sits below a.
    expect(at.x!.y).toBeLessThan(at.y!.y);
    expect(at.z).toEqual({ x: 7, y: 9 });
    expect(validEdges(graph.nodes, [{ id: 'q', source: 'a', target: 'gone' }])).toEqual([]);
  });
});
