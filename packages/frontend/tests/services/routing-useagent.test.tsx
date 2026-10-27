import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAgentName } from '../../src/services/routing';

function at(path: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
}

describe('useAgentName', () => {
  it('extracts agent name from pathname', () => {
    const { result } = renderHook(() => useAgentName(), {
      wrapper: at('/harnesses/test-agent/overview'),
    });
    expect(result.current).toBe('test-agent');
  });

  it('returns a string (null outside a harness route)', () => {
    const inside = renderHook(() => useAgentName(), {
      wrapper: at('/harnesses/test-agent/overview'),
    });
    expect(typeof inside.result.current).toBe('string');
    const outside = renderHook(() => useAgentName(), { wrapper: at('/settings') });
    expect(outside.result.current).toBeNull();
  });
});
