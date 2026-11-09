import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DevSignInButton from '../../src/components/DevSignInButton';

describe('DevSignInButton', () => {
  it('names the seeded dev account and signs in with it on click', () => {
    const onSignIn = vi.fn();
    render(<DevSignInButton disabled={false} onSignIn={onSignIn} />);
    const btn = screen.getByRole('button', { name: /admin@thinker\.example\.com/ });
    expect(btn.getAttribute('type')).toBe('button');
    fireEvent.click(btn);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledWith('admin@thinker.example.com', expect.any(String));
  });

  it('does nothing while disabled', () => {
    const onSignIn = vi.fn();
    render(<DevSignInButton disabled onSignIn={onSignIn} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSignIn).not.toHaveBeenCalled();
  });
});
