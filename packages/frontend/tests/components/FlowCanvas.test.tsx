import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import FlowCanvas from '../../src/components/flow/FlowCanvas';
import { nodeTypes } from '../../src/components/flow/nodes';
import type { FlowEdge, FlowNode, Graph } from '../../src/components/flow/types';
import { resetLocaleForTests } from '../../src/i18n';

beforeAll(() => {
  // React Flow measures nodes and the viewport; jsdom has neither.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  if (!('DOMMatrixReadOnly' in globalThis)) {
    class M {
      m22 = 1;
      constructor(_t?: string) {}
    }
    (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = M;
  }
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
      cb: () => void,
    ) => setTimeout(cb, 0);
  }
});

beforeEach(() => resetLocaleForTests('en'));

const node = (id: string, data: Record<string, unknown> = {}, x = 0): FlowNode =>
  ({
    id,
    type: 'node',
    position: { x, y: 0 },
    data: { kind: 'node', icon: <i data-testid={'icon-' + id} />, title: 'Title ' + id, ...data },
  }) as FlowNode;

const edge = (id: string, source: string, target: string): FlowEdge =>
  ({ id, source, target }) as FlowEdge;

const graph = (nodes: FlowNode[], edges: FlowEdge[] = []): Graph => ({ nodes, edges });

describe('flow nodes (nodeTypes)', () => {
  function renderNode(kind: 'node' | 'source', data: Record<string, unknown>, selected = false) {
    const Comp = nodeTypes[kind] as unknown as React.ComponentType<Record<string, unknown>>;
    return render(
      <ReactFlowProvider>
        <Comp
          id="n1"
          data={{ kind, icon: <i data-testid="ic" />, title: 'Name', ...data }}
          selected={selected}
          type={kind}
          dragging={false}
          draggable={false}
          selectable
          deletable={false}
          zIndex={0}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    );
  }

  it('registers a source and a node view', () => {
    expect(Object.keys(nodeTypes).sort()).toEqual(['node', 'source']);
  });

  it('step: icon in the box, title and subtitle below, tooltip as title attribute', () => {
    const { container } = renderNode('node', { subtitle: 'sub', tooltip: '12 requests' });
    expect(screen.getByTestId('ic')).toBeTruthy();
    expect(container.querySelector('.n8n-name')!.textContent).toBe('Name');
    expect(container.querySelector('.n8n-sub')!.textContent).toBe('sub');
    expect(container.querySelector('.n8n-step')!.getAttribute('title')).toBe('12 requests');
  });

  it('step: omits an empty or null subtitle', () => {
    const { container, rerender } = renderNode('node', { subtitle: null });
    expect(container.querySelector('.n8n-sub')).toBeNull();
    rerender(<span />);
  });

  it('step: maps state, round and selection to classes', () => {
    const { container } = renderNode('node', { state: 'error', round: true }, true);
    const box = container.querySelector('.n8n-box')!;
    expect(box.className).toContain('is-error');
    expect(box.className).toContain('is-round');
    expect(box.className).toContain('is-selected');
    expect(box.className).not.toContain('has-badge');
  });

  it('step: draws a badge with an accessible name', () => {
    const { container } = renderNode('node', { badge: <b>3</b>, badgeLabel: 'three keys' });
    expect(screen.getByRole('img', { name: 'three keys' })).toBeTruthy();
    expect(container.querySelector('.n8n-box')!.className).toContain('has-badge');
  });

  it('step: draws handles only for the directions it links', () => {
    const none = renderNode('node', {});
    expect(none.container.querySelectorAll('.react-flow__handle')).toHaveLength(0);
    none.unmount();
    const both = renderNode('node', { inbound: true, outbound: true });
    expect(both.container.querySelector('.react-flow__handle.target')).not.toBeNull();
    expect(both.container.querySelector('.react-flow__handle.source')).not.toBeNull();
  });

  it('source: shows the given lines, or the title when there are none', () => {
    const lines = renderNode('source', { lines: ['10.0.0.1', 'laptop'] });
    expect(
      [...lines.container.querySelectorAll('.n8n-source-lines span')].map((s) => s.textContent),
    ).toEqual(['10.0.0.1', 'laptop']);
    lines.unmount();
    const title = renderNode('source', {});
    expect(title.container.querySelector('.n8n-source-lines')!.textContent).toBe('Name');
  });

  it('source: dense text, state, selection and the output handle', () => {
    const { container } = renderNode(
      'source',
      { dense: true, state: 'active', outbound: true, tooltip: 'tip' },
      true,
    );
    expect(container.querySelector('.n8n-source-lines')!.className).toContain('is-dense');
    const root = container.querySelector('.n8n-source')!;
    expect(root.className).toContain('is-active');
    expect(root.className).toContain('is-selected');
    expect(root.getAttribute('title')).toBe('tip');
    expect(container.querySelector('.react-flow__handle.source')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle.target')).toBeNull();
  });
});

describe('FlowCanvas', () => {
  it('renders the stage with its nodes and zoom/mode controls', () => {
    const { container } = render(<FlowCanvas graph={graph([node('a'), node('b', {}, 400)])} />);
    expect(container.querySelector('.stage-wrap')).not.toBeNull();
    expect(container.querySelector('.react-flow')).not.toBeNull();
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2);
    expect(screen.getByText('Title a')).toBeTruthy();
    expect(screen.getByText('Title b')).toBeTruthy();
    expect(container.querySelector('.react-flow__controls-zoomin')).not.toBeNull();
  });

  it('renders an empty graph with just the hint', () => {
    const { container } = render(<FlowCanvas graph={graph([])} hint="Nothing here yet" />);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(0);
    expect(container.querySelector('.stage-hint')!.textContent).toBe('Nothing here yet');
  });

  it('omits the hint and legend containers when not given', () => {
    const { container } = render(<FlowCanvas graph={graph([node('a')])} legend={[]} />);
    expect(container.querySelector('.stage-hint')).toBeNull();
    expect(container.querySelector('.stage-legend')).toBeNull();
  });

  it('draws the legend with its variants', () => {
    const { container } = render(
      <FlowCanvas
        graph={graph([node('a')])}
        legend={[
          { id: '1', label: 'Traffic' },
          { id: '2', label: 'Fallback', dashed: true },
          { id: '3', label: 'Errors', error: true },
          { id: '4', label: 'No traffic', idle: true },
        ]}
      />,
    );
    const items = [...container.querySelectorAll('.stage-legend span')];
    expect(items.map((i) => i.textContent)).toEqual([
      'Traffic',
      'Fallback',
      'Errors',
      'No traffic',
    ]);
    expect(items[0].className).toBe('');
    expect(items[1].className).toBe('is-dashed');
    expect(items[2].className).toBe('is-error');
    expect(items[3].className).toBe('is-idle');
  });

  it('drops edges whose endpoints are missing instead of crashing', () => {
    const { container } = render(
      <FlowCanvas
        graph={graph(
          [node('a'), node('b', {}, 400)],
          [edge('e1', 'a', 'b'), edge('e2', 'a', 'ghost')],
        )}
      />,
    );
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2);
    // The stale edge is filtered before React Flow sees it.
    expect(container.querySelector('[data-id="e2"]')).toBeNull();
  });

  it('toggles between pan and select mode from the control button', () => {
    const { container } = render(<FlowCanvas graph={graph([node('a')])} />);
    const pan = screen.getByRole('button', { name: /^Pan mode/ });
    expect(pan.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.stage-wrap')!.className).not.toContain('is-selecting');
    fireEvent.click(pan);
    const select = screen.getByRole('button', { name: /^Select mode/ });
    expect(select.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.stage-wrap')!.className).toContain('is-selecting');
    fireEvent.click(select);
    expect(screen.getByRole('button', { name: /^Pan mode/ })).toBeTruthy();
  });

  it('offers the reset-layout button only when a handler is given', () => {
    const onResetLayout = vi.fn();
    const { unmount } = render(<FlowCanvas graph={graph([node('a')])} />);
    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull();
    unmount();
    render(<FlowCanvas graph={graph([node('a')])} onResetLayout={onResetLayout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(onResetLayout).toHaveBeenCalledTimes(1);
  });

  it('does not show a minimap for small graphs', () => {
    const { container } = render(<FlowCanvas graph={graph([node('a')])} />);
    expect(container.querySelector('.react-flow__minimap')).toBeNull();
  });

  it('shows a minimap past 24 nodes', () => {
    const many = Array.from({ length: 25 }, (_, i) => node('n' + i, {}, i * 400));
    const { container } = render(<FlowCanvas graph={graph(many)} />);
    expect(container.querySelector('.react-flow__minimap')).not.toBeNull();
  });

  it('picks up new nodes when the graph prop changes', () => {
    const { container, rerender } = render(<FlowCanvas graph={graph([node('a')])} />);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
    rerender(<FlowCanvas graph={graph([node('a'), node('b', {}, 400)])} />);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2);
    rerender(<FlowCanvas graph={graph([node('b', {}, 400)])} />);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
  });

  it('reacts to the f key without throwing, but ignores it while typing in a field', () => {
    render(
      <>
        <input aria-label="search" />
        <FlowCanvas graph={graph([node('a')])} />
      </>,
    );
    act(() => {
      fireEvent.keyDown(document.body, { key: 'f' });
    });
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'f' });
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
  });

  it('opens a node on double click through onNodeOpen (editable stage)', () => {
    const onNodeOpen = vi.fn();
    const { container } = render(
      <FlowCanvas graph={graph([node('a', { href: '/x' })])} onNodeOpen={onNodeOpen} editable />,
    );
    fireEvent.doubleClick(container.querySelector('.react-flow__node')!);
    expect(onNodeOpen).toHaveBeenCalledTimes(1);
    expect(onNodeOpen.mock.calls[0][0].id).toBe('a');
  });

  it('opens a node on double click on a read-only stage', () => {
    const onNodeOpen = vi.fn();
    const { container } = render(
      <FlowCanvas graph={graph([node('a', { href: '/x' })])} onNodeOpen={onNodeOpen} />,
    );
    fireEvent.doubleClick(container.querySelector('.react-flow__node')!);
    expect(onNodeOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps nodes non-draggable by default and draggable when editable', () => {
    const { container, rerender } = render(<FlowCanvas graph={graph([node('a')])} />);
    expect(container.querySelector('.react-flow__node')!.className).not.toContain('draggable');
    rerender(<FlowCanvas graph={graph([node('a')])} editable />);
    expect(container.querySelector('.react-flow__node')!.className).toContain('draggable');
  });

  it('labels the controls in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<FlowCanvas graph={graph([node('a')])} onResetLayout={() => {}} />);
    expect(screen.getByRole('button', { name: /^Modo mover/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pan mode/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull();
  });
});
