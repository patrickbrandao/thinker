import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockReveal = vi.fn();
vi.mock('../../src/services/api', async (orig) => ({
  ...(await orig<object>()),
  revealConnectionKey: (id: string) => mockReveal(id),
}));

import ConnectionKeyField from '../../src/components/ConnectionKeyField';
import { setMe } from '../../src/services/session-store';

const asRole = (role: 'owner' | 'admin' | 'member' | 'viewer') =>
  setMe({
    userId: 'u1',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'o1', name: 'Acme', role },
  } as never);

const MASKED = 'sk-proj-ABCD********WXYZ';
const FULL = 'sk-proj-ABCDEFGHIJKLMNOPQRS-WXYZ';

describe('ConnectionKeyField', () => {
  beforeEach(() => {
    mockReveal.mockReset().mockResolvedValue({ id: 'c1', api_key: FULL });
  });
  afterEach(() => setMe(null));

  it('shows the masked key and an eye button to an owner on an API-key connection', () => {
    asRole('owner');
    render(<ConnectionKeyField connectionId="c1" authType="api_key" keyMasked={MASKED} />);
    expect(screen.getByText(MASKED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show full key' })).toBeTruthy();
  });

  it('offers the eye button for a local server key too', () => {
    asRole('owner');
    render(<ConnectionKeyField connectionId="c1" authType="local" keyMasked="pub***" />);
    expect(screen.getByRole('button', { name: 'Show full key' })).toBeTruthy();
  });

  it.each(['admin', 'member', 'viewer'] as const)('shows only the mask to a %s', (role) => {
    asRole(role);
    render(<ConnectionKeyField connectionId="c1" authType="api_key" keyMasked={MASKED} />);
    expect(screen.getByText(MASKED)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show full key' })).toBeNull();
  });

  it('never offers the eye button for a subscription credential', () => {
    asRole('owner');
    render(
      <ConnectionKeyField connectionId="c1" authType="subscription" keyMasked="sk-a********" />,
    );
    expect(screen.queryByRole('button', { name: 'Show full key' })).toBeNull();
  });

  it('hides the eye button while the user is unknown', () => {
    setMe(null);
    render(<ConnectionKeyField connectionId="c1" authType="api_key" keyMasked={MASKED} />);
    expect(screen.queryByRole('button', { name: 'Show full key' })).toBeNull();
  });

  it('reveals the full key on click and hides it on a second click', async () => {
    asRole('owner');
    render(<ConnectionKeyField connectionId="c1" authType="api_key" keyMasked={MASKED} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show full key' }));
    await waitFor(() => expect(screen.getByText(FULL)).toBeTruthy());
    expect(mockReveal).toHaveBeenCalledWith('c1');
    expect(screen.queryByText(MASKED)).toBeNull();
    expect(document.querySelector('.copy-btn')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(screen.getByText(MASKED)).toBeTruthy();
    expect(screen.queryByText(FULL)).toBeNull();
    expect(document.querySelector('.copy-btn')).toBeNull();
    expect(mockReveal).toHaveBeenCalledTimes(1);
  });

  it('keeps the mask and shows the error when the reveal is refused', async () => {
    asRole('owner');
    mockReveal.mockRejectedValueOnce(new Error('The stored key could not be decrypted.'));
    render(<ConnectionKeyField connectionId="c1" authType="api_key" keyMasked={MASKED} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show full key' }));
    await waitFor(() =>
      expect(screen.getByText('The stored key could not be decrypted.')).toBeTruthy(),
    );
    expect(screen.getByText(MASKED)).toBeTruthy();
  });

  it('renders nothing without a stored key', () => {
    asRole('owner');
    const { container } = render(
      <ConnectionKeyField connectionId="c1" authType="api_key" keyMasked={null} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
