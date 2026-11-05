import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const api = vi.hoisted(() => ({
  listTriggers: vi.fn(),
  getHarnessTriggers: vi.fn(),
  setHarnessTriggers: vi.fn(),
}));
vi.mock('../../src/services/api/triggers.js', () => api);

import AgentTriggers from '../../src/pages/AgentTriggers';
import { setMe } from '../../src/services/session-store';
import { resetLocaleForTests, t } from '../../src/i18n';
import type { OrgRole } from '../../src/services/api/organizations';

const triggers = [
  { id: 't1', name: 'ops-mail', type: 'email', enabled: true },
  { id: 't2', name: 'chat', type: 'telegram', enabled: false },
];

const asRole = (role: OrgRole | null) =>
  setMe(
    role
      ? { userId: 'u', isInstanceAdmin: false, mustChangePassword: false, organization: { id: 'o', name: 'Acme', role } }
      : null,
  );

const renderPage = (agent = 'my-bot') =>
  render(
    <MemoryRouter initialEntries={[`/harnesses/${agent}/triggers`]}>
      <Routes>
        <Route path="/harnesses/:agentName/triggers" element={<AgentTriggers />} />
      </Routes>
    </MemoryRouter>,
  );

describe('AgentTriggers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('admin');
    api.listTriggers.mockResolvedValue(triggers);
    api.getHarnessTriggers.mockResolvedValue([{ trigger_id: 't1', events: ['limit.alert'] }]);
    api.setHarnessTriggers.mockImplementation((_a: string, b: unknown) => Promise.resolve(b));
  });

  it('loads the workspace triggers and the bindings of the harness from the route', async () => {
    renderPage();
    expect(await screen.findByText('ops-mail')).toBeTruthy();
    expect(api.getHarnessTriggers).toHaveBeenCalledWith('my-bot');
    expect(api.listTriggers).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('ops-mail: Limit alert')).toBeTruthy();
  });

  it('decodes the harness name from the URL', async () => {
    renderPage('my%20bot');
    await waitFor(() => expect(api.getHarnessTriggers).toHaveBeenCalledWith('my bot'));
  });

  it('lets a member of the workspace edit the bindings', async () => {
    asRole('member');
    renderPage();
    await screen.findByText('ops-mail');
    expect(screen.getByText('Add triggers')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('hides the editing actions from a viewer', async () => {
    asRole('viewer');
    renderPage();
    await screen.findByText('ops-mail');
    expect(screen.queryByText('Add triggers')).toBeNull();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('saving a change stores it through the API and keeps the new bindings', async () => {
    renderPage();
    await screen.findByText('ops-mail');
    fireEvent.click(screen.getByLabelText('ops-mail: Limit block'));
    await waitFor(() => expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(api.setHarnessTriggers).toHaveBeenCalledWith('my-bot', [
        { trigger_id: 't1', events: ['limit.alert', 'limit.block'] },
      ]),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('ops-mail: Limit block') as HTMLInputElement).checked).toBe(true),
    );
  });

  it('shows the empty message when the workspace has no triggers', async () => {
    api.listTriggers.mockResolvedValue([]);
    api.getHarnessTriggers.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No triggers in this workspace yet.')).toBeTruthy();
  });

  it('sets the page title with the harness name', async () => {
    renderPage();
    await screen.findByText('ops-mail');
    expect(document.querySelector('title')?.textContent).toContain('my-bot');
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    api.listTriggers.mockResolvedValue([]);
    api.getHarnessTriggers.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(t('triggers.harness.empty'))).toBeTruthy();
    expect(t('triggers.harness.empty')).not.toBe('No triggers in this workspace yet.');
  });
});
