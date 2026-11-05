import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TemporaryPasswordBox from '../../src/components/TemporaryPasswordBox';
import { resetLocaleForTests } from '../../src/i18n';

const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('TemporaryPasswordBox', () => {
  it('shows who the password belongs to, the password and the one-time warning', () => {
    render(
      <TemporaryPasswordBox email="ana@example.com" password="p@ss-123" onDismiss={() => {}} />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Temporary password for ana@example.com',
    );
    expect(screen.getByTestId('temporary-password').textContent).toBe('p@ss-123');
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
  });

  it('copies the exact password', async () => {
    render(<TemporaryPasswordBox email="a@b.c" password="p@ss-123" onDismiss={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    });
    expect(writeText).toHaveBeenCalledWith('p@ss-123');
  });

  it('calls onDismiss from the acknowledge button', () => {
    const onDismiss = vi.fn();
    render(<TemporaryPasswordBox email="a@b.c" password="x" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'I saved it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<TemporaryPasswordBox email="a@b.c" password="x" onDismiss={() => {}} />);
    expect(screen.queryByRole('button', { name: 'I saved it' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('a@b.c');
    expect(screen.getByRole('status').textContent).not.toContain('Temporary password');
  });
});
