import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ToastContainer from '../../src/components/ToastContainer';
import { addToast, dismissToast, toasts } from '../../src/services/toast-store';

describe('ToastContainer', () => {
  // Clear all toasts before each test
  beforeEach(() => {
    for (const t of toasts()) {
      dismissToast(t.id);
    }
  });

  it('renders empty when no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.querySelectorAll('.toast').length).toBe(0);
  });

  it('renders a toast message', () => {
    addToast('error', 'Something went wrong');
    render(<ToastContainer />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('renders multiple toasts', () => {
    addToast('success', 'Saved!');
    addToast('warning', 'Watch out');
    const { container } = render(<ToastContainer />);
    expect(container.querySelectorAll('.toast').length).toBe(2);
  });

  it('applies correct class based on toast type', () => {
    addToast('error', 'Error toast');
    const { container } = render(<ToastContainer />);
    expect(container.querySelector('.toast.is-error')).not.toBeNull();
  });

  it('has dismiss button', () => {
    addToast('success', 'Done');
    render(<ToastContainer />);
    expect(screen.getByLabelText('Dismiss notification')).toBeDefined();
  });

  it('has role=alert for accessibility', () => {
    addToast('error', 'Alert');
    render(<ToastContainer />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('shows a toast added after mount and removes it when dismissed', () => {
    render(<ToastContainer />);
    act(() => addToast('success', 'Later'));
    expect(screen.getByText('Later')).toBeDefined();
    act(() => screen.getByLabelText('Dismiss notification').click());
    expect(screen.queryByText('Later')).toBeNull();
  });
});
