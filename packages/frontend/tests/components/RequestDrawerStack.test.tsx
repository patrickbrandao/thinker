import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../src/components/RequestDrawer.js', () => ({
  default: (props: Record<string, any>) => (
    <div data-testid="win" data-id={props.messageId} data-pinned={String(!!props.pinned)}>
      <button onClick={props.onTogglePin}>pin-{props.messageId}</button>
      <button onClick={props.onClose}>close-{props.messageId}</button>
    </div>
  ),
}));

import RequestDrawerStack from '../../src/components/RequestDrawerStack';

const wins = () =>
  screen.queryAllByTestId('win').map((w) => `${w.dataset.id}:${w.dataset.pinned}`);

describe('RequestDrawerStack', () => {
  it('reuses the unpinned window, and opens a new one after pinning', () => {
    const onClose = vi.fn();
    const { rerender } = render(<RequestDrawerStack messageId="a" onClose={onClose} />);
    rerender(<RequestDrawerStack messageId="b" onClose={onClose} />);
    expect(wins()).toEqual(['b:false']);

    fireEvent.click(screen.getByText('pin-b'));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<RequestDrawerStack messageId={null} onClose={onClose} />);
    expect(wins()).toEqual(['b:true']);

    rerender(<RequestDrawerStack messageId="c" onClose={onClose} />);
    rerender(<RequestDrawerStack messageId="d" onClose={onClose} />);
    expect(wins()).toEqual(['b:true', 'd:false']);
  });

  it('closes a pinned window without clearing the selection', () => {
    const onClose = vi.fn();
    const { rerender } = render(<RequestDrawerStack messageId="a" onClose={onClose} />);
    fireEvent.click(screen.getByText('pin-a'));
    rerender(<RequestDrawerStack messageId="b" onClose={onClose} />);
    onClose.mockClear();
    fireEvent.click(screen.getByText('close-a'));
    expect(onClose).not.toHaveBeenCalled();
    expect(wins()).toEqual(['b:false']);
    fireEvent.click(screen.getByText('close-b'));
    expect(onClose).toHaveBeenCalled();
    expect(wins()).toEqual([]);
  });

  it('unpinning makes that window follow the selection and drops the other free one', () => {
    const onClose = vi.fn();
    const { rerender } = render(<RequestDrawerStack messageId="a" onClose={onClose} />);
    fireEvent.click(screen.getByText('pin-a'));
    rerender(<RequestDrawerStack messageId="b" onClose={onClose} />);
    fireEvent.click(screen.getByText('pin-a'));
    expect(wins()).toEqual(['a:false']);
    rerender(<RequestDrawerStack messageId="c" onClose={onClose} />);
    expect(wins()).toEqual(['c:false']);
  });
});
