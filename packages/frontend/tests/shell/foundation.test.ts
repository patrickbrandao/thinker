import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { signal, useSignal } from '../../src/lib/signal';
import { useResource } from '../../src/lib/use-resource';
import { autoLayout, validEdges } from '../../src/components/flow/layout';
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
  it('places each node one column right of its deepest parent', () => {
    const node = (id: string) => ({
      id,
      type: 'item' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'item' as const, title: id },
    });
    const graph = autoLayout({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
        { id: 'ac', source: 'a', target: 'c' },
      ],
    });
    const x = Object.fromEntries(graph.nodes.map((n) => [n.id, n.position.x]));
    expect(x.a).toBeLessThan(x.b!);
    expect(x.b).toBeLessThan(x.c!);
    expect(validEdges(graph.nodes, [{ id: 'z', source: 'a', target: 'gone' }])).toEqual([]);
  });
});
