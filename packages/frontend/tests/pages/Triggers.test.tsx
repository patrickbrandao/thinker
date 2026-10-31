import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const api = vi.hoisted(() => ({
  listTriggers: vi.fn(),
  createTrigger: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  testTrigger: vi.fn(),
  listTriggerEvents: vi.fn(),
  getTriggerEvent: vi.fn(),
  retryTriggerEvent: vi.fn(),
}));
vi.mock('../../src/services/api/triggers.js', () => api);

import { setMe } from '../../src/services/session-store';
import Triggers from '../../src/pages/Triggers';
import type { OrgRole } from '../../src/services/api/organizations';

const hook = {
  id: 't1',
  name: 'ops-hook',
  type: 'webhook',
  enabled: true,
  config: {
    method: 'POST',
    url: 'https://x.io/h',
    content_type: 'application/json',
    body: '{{event.json}}',
    headers: [],
  },
  secrets: { hmacSecret: null },
  max_retries: 3,
  retry_delay_seconds: 30,
  timeout_seconds: 10,
  workspace_events: [],
  harness_count: 2,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const asRole = (role: OrgRole) =>
  setMe({
    userId: 'u-me',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'org-1', name: 'Acme', role },
  });

const renderPage = () =>
  render(
    <MemoryRouter>
      <Triggers />
    </MemoryRouter>,
  );

describe('Triggers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTriggers.mockResolvedValue([hook]);
    api.listTriggerEvents.mockResolvedValue([]);
  });

  it('is read-only for a member: no create, no deliveries tab, view only', async () => {
    asRole('member');
    renderPage();
    await screen.findByText('ops-hook');
    expect(screen.getByText('2 harnesses')).toBeTruthy();
    expect(screen.queryByText('New trigger')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Deliveries' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByText('View'));
    expect(await screen.findByRole('dialog', { name: 'Trigger' })).toBeTruthy();
    expect(screen.queryByText('Create trigger')).toBeNull();
  });

  it('creates a webhook trigger from the editor', async () => {
    asRole('admin');
    api.createTrigger.mockResolvedValue({ ...hook, id: 't2', name: 'new-hook' });
    renderPage();
    await screen.findByText('ops-hook');
    fireEvent.click(screen.getByText('New trigger'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'new-hook' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://y.io/h' } });
    fireEvent.click(screen.getByText('Create trigger'));
    await waitFor(() => expect(api.createTrigger).toHaveBeenCalledTimes(1));
    const payload = api.createTrigger.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'new-hook',
      type: 'webhook',
      enabled: true,
      config: { method: 'POST', url: 'https://y.io/h', body: '{{event.json}}' },
    });
    expect(payload.secrets).toBeUndefined();
  });

  it('toggles a trigger and shows the deliveries tab to an admin', async () => {
    asRole('owner');
    api.updateTrigger.mockResolvedValue({ ...hook, enabled: false });
    api.listTriggerEvents.mockResolvedValue([
      {
        id: 'e1',
        trigger_id: 't1',
        trigger_name: 'ops-hook',
        trigger_type: 'webhook',
        event_type: 'limit.alert',
        agent_name: 'bot',
        status: 'failed',
        attempts: 3,
        next_attempt_at: null,
        last_error: 'HTTP 500',
        created_at: '2026-10-01T00:00:00.000Z',
        delivered_at: null,
      },
    ]);
    api.getTriggerEvent.mockResolvedValue({
      event: {
        ...(await api.listTriggerEvents())[0],
        payload: { 'harness.name': 'bot' },
      },
      logs: [
        {
          id: 'l1',
          attempt: 1,
          started_at: '2026-10-01T00:00:00.000Z',
          duration_ms: 120,
          success: false,
          status_code: 500,
          error: 'HTTP 500',
          response: 'upstream down',
        },
      ],
    });
    api.retryTriggerEvent.mockResolvedValue({ ok: true });
    renderPage();
    await screen.findByText('ops-hook');
    fireEvent.click(screen.getByRole('switch', { name: 'Enable ops-hook' }));
    await waitFor(() => expect(api.updateTrigger).toHaveBeenCalledWith('t1', { enabled: false }));

    fireEvent.click(screen.getByRole('tab', { name: 'Deliveries' }));
    fireEvent.click(await screen.findByText('HTTP 500'));
    expect(await screen.findByText('upstream down')).toBeTruthy();
    expect(screen.getByText('harness.name')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(api.retryTriggerEvent).toHaveBeenCalledWith('e1'));
  });
});
