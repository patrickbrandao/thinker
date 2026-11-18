import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listAgentKeys: vi.fn(),
  createAgentKey: vi.fn(),
  updateAgentKey: vi.fn(),
  revokeAgentKey: vi.fn(),
  rotateAgentKey: vi.fn(),
}));
vi.mock('../../src/services/api/agent-keys.js', async (orig) => ({
  ...(await orig<object>()),
  listAgentKeys: api.listAgentKeys,
  createAgentKey: api.createAgentKey,
  updateAgentKey: api.updateAgentKey,
  revokeAgentKey: api.revokeAgentKey,
}));
vi.mock('../../src/services/api/agents.js', async (orig) => ({
  ...(await orig<object>()),
  rotateAgentKey: api.rotateAgentKey,
}));
vi.mock('../../src/components/CopyButton', () => ({ default: () => <button>Copy</button> }));

import AgentKeysPanel from '../../src/components/AgentKeysPanel';
import { setMe } from '../../src/services/session-store';
import type { AgentKeyView } from '../../src/services/api/agent-keys';
import type { OrgRole } from '../../src/services/api/organizations';

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * DAY).toISOString();

const key = (over: Partial<AgentKeyView>): AgentKeyView => ({
  id: 'k',
  name: null,
  keyPrefix: 'thk_abcd',
  isPrimary: false,
  status: 'active',
  expiresAt: null,
  lastUsedAt: null,
  createdAt: ago(1),
  revokedAt: null,
  ...over,
});

const primary = key({ id: 'p', isPrimary: true, keyPrefix: 'thk_prim', lastUsedAt: ago(0) });
const ci = key({ id: 'k1', name: 'CI runner', expiresAt: ahead(30), createdAt: ago(120) });
const old = key({ id: 'k2', name: 'Old', status: 'revoked', revokedAt: ago(2) });

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'o', name: 'Acme', role },
  });

describe('AgentKeysPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('member');
    api.listAgentKeys.mockResolvedValue({ keys: [primary, ci, old] });
  });

  it('lists keys, flags unused ones and hides revoked keys behind a toggle', async () => {
    render(<AgentKeysPanel agentName="demo" />);
    const ciRow = (await screen.findByText('CI runner')).closest('tr')!;
    expect(within(ciRow).getByText('thk_abcd…')).toBeTruthy();
    expect(within(ciRow).getByText('Active')).toBeTruthy();
    expect(within(ciRow).getByText('in 30d')).toBeTruthy();
    expect(within(ciRow).getByText('Unused 90+ days')).toBeTruthy();
    const primaryRow = screen.getByText('Primary key').closest('tr')!;
    expect(within(primaryRow).getByText('Primary')).toBeTruthy();
    expect(within(primaryRow).getByText('Never expires')).toBeTruthy();
    expect(within(primaryRow).queryByText('Unused 90+ days')).toBeNull();

    expect(screen.queryByText('Old')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show revoked (1)' }));
    expect(screen.getByText('Old')).toBeTruthy();
    expect(api.listAgentKeys).toHaveBeenCalledWith('demo');
  });

  it('offers rotate (not revoke) for the primary key', async () => {
    api.rotateAgentKey.mockResolvedValue({ apiKey: 'thk_newprimary' });
    const onRotated = vi.fn();
    render(<AgentKeysPanel agentName="demo" onPrimaryRotated={onRotated} />);
    await screen.findByText('Primary key');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Primary key' }));
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the primary key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }));
    expect(await screen.findByTestId('new-agent-key')).toHaveProperty(
      'textContent',
      'thk_newprimary',
    );
    expect(api.rotateAgentKey).toHaveBeenCalledWith('demo');
    expect(onRotated).toHaveBeenCalled();
  });

  it('creates a key with an expiry preset and shows it once', async () => {
    api.createAgentKey.mockResolvedValue({
      key: key({ id: 'k3', name: 'Deploy' }),
      apiKey: 'thk_fullsecret',
    });
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');
    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    const dialog = screen.getByRole('dialog', { name: 'New API key' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Deploy' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '7 days' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    await waitFor(() => expect(api.createAgentKey).toHaveBeenCalled());
    const [agent, body] = api.createAgentKey.mock.calls[0]!;
    expect(agent).toBe('demo');
    expect(body.name).toBe('Deploy');
    const days = (Date.parse(body.expiresAt) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const secret = await screen.findByTestId('new-agent-key');
    expect(secret.textContent).toBe('thk_fullsecret');
    expect(screen.getByText('Copy this key now. It will not be shown again.')).toBeTruthy();
  });

  it('rejects a custom date beyond 365 days', async () => {
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');
    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    const dialog = screen.getByRole('dialog', { name: 'New API key' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Custom date' }));
    fireEvent.change(within(dialog).getByLabelText('Expiry date'), {
      target: { value: '2099-01-01' },
    });
    expect(
      within(dialog).getByText('Pick a date after today and at most 365 days ahead.'),
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Create key' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('disables and revokes an extra key', async () => {
    api.updateAgentKey.mockResolvedValue({ key: { ...ci, status: 'disabled' } });
    api.revokeAgentKey.mockResolvedValue({ key: { ...ci, status: 'revoked' } });
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() =>
      expect(api.updateAgentKey).toHaveBeenCalledWith('demo', 'k1', { disabled: true }),
    );
    const row = screen.getByText('CI runner').closest('tr')!;
    await within(row).findByText('Disabled');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.revokeAgentKey).toHaveBeenCalledWith('demo', 'k1'));
    await waitFor(() => expect(screen.queryByText('CI runner')).toBeNull());
  });

  it('is read-only for viewers', async () => {
    asRole('viewer');
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });
});
