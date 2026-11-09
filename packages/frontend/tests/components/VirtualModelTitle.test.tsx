import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VirtualModelTitle from '../../src/components/VirtualModelTitle';

describe('VirtualModelTitle', () => {
  it('shows the model name as a code badge', () => {
    const { container } = render(<VirtualModelTitle name="fast-coder" onShowExample={() => {}} />);
    expect(container.querySelector('code')!.textContent).toBe('fast-coder');
  });

  it('has an example button named after the model that fires the callback', () => {
    const onShowExample = vi.fn();
    render(<VirtualModelTitle name="auto" onShowExample={onShowExample} />);
    const btn = screen.getByRole('button', { name: /auto/ });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('title')).toBeTruthy();
    fireEvent.click(btn);
    expect(onShowExample).toHaveBeenCalledTimes(1);
  });
});
