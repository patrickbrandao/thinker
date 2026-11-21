import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listAgentKeys: vi.fn(),
  createAgentKey: vi.fn(),
  updateAgentKey: vi.fn(),
  revokeAgentKey: vi.fn(),
  rotateOneAgentKey: vi.fn(),
  getAgentKeySecret: vi.fn(),
}));
vi.mock('../../src/services/api/agent-keys.js', async (orig) => ({
  ...(await orig<object>()),
  listAgentKeys: api.listAgentKeys,
  createAgentKey: api.createAgentKey,
  updateAgentKey: api.updateAgentKey,
  revokeAgentKey: api.revokeAgentKey,
  rotateOneAgentKey: api.rotateOneAgentKey,
  getAgentKeySecret: api.getAgentKeySecret,
}));
const ipApi = vi.hoisted(() => ({ listIpPrefixLists: vi.fn(), updateIpRestriction: vi.fn() }));
vi.mock('../../src/services/api/ip-prefix-lists.js', async (orig) => ({
  ...(await orig<object>()),
  listIpPrefixLists: ipApi.listIpPrefixLists,
  updateIpRestriction: ipApi.updateIpRestriction,
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
  recoverable: true,
  ipRestriction: { enabled: false, listIds: [] },
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
    ipApi.listIpPrefixLists.mockResolvedValue({ lists: [] });
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
    expect(within(primaryRow).getByText('Never')).toBeTruthy();
    expect(within(primaryRow).queryByText('Unused 90+ days')).toBeNull();

    expect(screen.queryByText('Old')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show removed (1)' }));
    expect(screen.getByText('Old')).toBeTruthy();
    expect(api.listAgentKeys).toHaveBeenCalledWith('demo');
  });

  it('offers rotate (not remove) for the primary key', async () => {
    api.rotateOneAgentKey.mockResolvedValue({ key: primary, apiKey: 'thk_newprimary' });
    const onRotated = vi.fn();
    render(<AgentKeysPanel agentName="demo" onPrimaryRotated={onRotated} />);
    await screen.findByText('Primary key');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Primary key' }));
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the primary key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }));
    expect(await screen.findByTestId('new-agent-key')).toHaveProperty(
      'textContent',
      'thk_newprimary',
    );
    expect(api.rotateOneAgentKey).toHaveBeenCalledWith('demo', 'p');
    expect(onRotated).toHaveBeenCalled();
  });

  it('rotates an extra key and shows the new secret once', async () => {
    api.rotateOneAgentKey.mockResolvedValue({ key: ci, apiKey: 'thk_newci' });
    const onRotated = vi.fn();
    render(<AgentKeysPanel agentName="demo" onPrimaryRotated={onRotated} />);
    await screen.findByText('CI runner');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate CI runner?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }));
    expect(await screen.findByTestId('new-agent-key')).toHaveProperty('textContent', 'thk_newci');
    expect(api.rotateOneAgentKey).toHaveBeenCalledWith('demo', 'k1');
    expect(onRotated).not.toHaveBeenCalled();
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
    expect(
      screen.getByText('Copy this key now. You can also see it later in the key list.'),
    ).toBeTruthy();
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

  it('edits (renames, disables) and removes an extra key', async () => {
    api.updateAgentKey.mockResolvedValue({ key: { ...ci, name: 'CI', status: 'disabled' } });
    api.revokeAgentKey.mockResolvedValue({ key: { ...ci, status: 'revoked' } });
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('dialog', { name: 'Edit key' });
    expect(within(edit).queryByRole('switch', { name: 'Restrict source IP' })).toBeNull();
    fireEvent.change(within(edit).getByLabelText('Name'), { target: { value: 'CI' } });
    fireEvent.click(within(edit).getByRole('switch', { name: 'Active' }));
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateAgentKey).toHaveBeenCalledWith('demo', 'k1', {
        name: 'CI',
        disabled: true,
      }),
    );
    const row = (await screen.findByText('CI')).closest('tr')!;
    await within(row).findByText('Disabled');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.revokeAgentKey).toHaveBeenCalledWith('demo', 'k1'));
    await waitFor(() => expect(screen.queryByText('CI')).toBeNull());
  });

  it('is read-only for viewers', async () => {
    asRole('viewer');
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('shows each key source IP restriction; only admins can change it', async () => {
    api.listAgentKeys.mockResolvedValue({
      keys: [primary, { ...ci, ipRestriction: { enabled: true, listIds: ['l1'] } }],
    });
    ipApi.listIpPrefixLists.mockResolvedValue({
      lists: [
        {
          id: 'l1',
          name: 'Office',
          description: null,
          entries: [],
          harnesses: [],
          keys: [],
          createdAt: ago(1),
          updatedAt: ago(1),
        },
      ],
    });
    const { unmount } = render(
      <MemoryRouter>
        <AgentKeysPanel agentName="demo" />
      </MemoryRouter>,
    );
    const ciRow = (await screen.findByText('CI runner')).closest('tr')!;
    expect(within(ciRow).getByText('Restricted')).toBeTruthy();
    const primaryRow = screen.getByText('Primary key').closest('tr')!;
    expect(within(primaryRow).getByText('All')).toBeTruthy();
    expect(ipApi.listIpPrefixLists).not.toHaveBeenCalled();
    unmount();

    asRole('admin');
    render(
      <MemoryRouter>
        <AgentKeysPanel agentName="demo" />
      </MemoryRouter>,
    );
    const row = (await screen.findByText('CI runner')).closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Office')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('dialog', { name: 'Edit key' });
    const toggle = within(edit).getByRole('switch', { name: 'Restrict source IP' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(edit).getByLabelText('Office'));
    expect(
      within(edit).getByText('Pick at least one IP ACL to turn the restriction on.'),
    ).toBeTruthy();
    fireEvent.click(toggle);
    ipApi.updateIpRestriction.mockResolvedValue({ enabled: false, listIds: [] });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(ipApi.updateIpRestriction).toHaveBeenCalledWith('demo', 'k1', {
        enabled: false,
        listIds: [],
      }),
    );
    expect(api.updateAgentKey).not.toHaveBeenCalled();
    await waitFor(() => expect(within(row).getByText('All')).toBeTruthy());
  });

  it('clears an extra key expiry with "Never expires"', async () => {
    api.updateAgentKey.mockResolvedValue({ key: { ...ci, expiresAt: null } });
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('dialog', { name: 'Edit key' });
    const never = within(edit).getByRole('radio', { name: 'Never expires' });
    expect(never.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(never);
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateAgentKey).toHaveBeenCalledWith('demo', 'k1', { expiresAt: null }),
    );
    const row = screen.getByText('CI runner').closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Never')).toBeTruthy());
  });

  it('copies a recoverable key from the menu; old keys have no copy option', async () => {
    api.getAgentKeySecret.mockResolvedValue({ keyPrefix: 'thk_abcd', apiKey: 'thk_abcd_full' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const legacy = key({ id: 'k9', name: 'Legacy', recoverable: false, expiresAt: ahead(5) });
    api.listAgentKeys.mockResolvedValue({ keys: [primary, ci, legacy] });
    render(<AgentKeysPanel agentName="demo" />);
    await screen.findByText('CI runner');
    expect(screen.queryByRole('button', { name: 'Reveal API key' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for CI runner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('thk_abcd_full'));
    expect(api.getAgentKeySecret).toHaveBeenCalledWith('demo', 'k1');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Legacy' }));
    expect(screen.queryByRole('button', { name: 'Copy key' })).toBeNull();
  });
});
