import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const api = vi.hoisted(() => ({ listTriggers: vi.fn(), testTrigger: vi.fn() }));
vi.mock('../../src/services/api/triggers.js', () => api);
vi.mock('../../src/services/api/agents.js', () => ({
  getAgents: vi.fn(() => Promise.resolve({ agents: [{ agent_name: 'bot', display_name: 'Bot' }] })),
}));

import { setMe } from '../../src/services/session-store';
import TriggerTest from '../../src/pages/TriggerTest';

const triggers = [
  {
    id: 't1',
    name: 'ops-hook',
    type: 'webhook',
    enabled: true,
    config: { method: 'POST', url: 'https://x.io/h', content_type: 'application/json', body: '' },
  },
  {
    id: 't2',
    name: 'mail',
    type: 'email',
    enabled: false,
    config: { provider: 'resend', to: ['a@x.io'] },
  },
];

describe('Trigger test page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMe({
      userId: 'u-me',
      isInstanceAdmin: false,
      mustChangePassword: false,
      organization: { id: 'org-1', name: 'Acme', role: 'admin' },
    });
    api.listTriggers.mockResolvedValue(triggers);
    api.testTrigger.mockResolvedValue({
      success: true,
      status_code: 200,
      error: null,
      response: 'ok',
      duration_ms: 12,
    });
  });

  it('sends the chosen event with the edited variables to the preselected trigger', async () => {
    render(
      <MemoryRouter initialEntries={['/triggers/test?trigger=t2&harness=bot']}>
        <TriggerTest />
      </MemoryRouter>,
    );
    expect(await screen.findByText('a@x.io')).toBeTruthy();
    expect(screen.getByText('Disabled: tests are still sent')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'limit.block' } });
    await waitFor(() =>
      expect((screen.getByLabelText('{{harness.display_name}}') as HTMLInputElement).value).toBe(
        'Bot',
      ),
    );
    fireEvent.change(screen.getByLabelText('{{rule.threshold}}'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Send Limit block'));
    await waitFor(() => expect(api.testTrigger).toHaveBeenCalledTimes(1));
    const [id, input] = api.testTrigger.mock.calls[0];
    expect(id).toBe('t2');
    expect(input.event_type).toBe('limit.block');
    expect(input.vars).toMatchObject({
      'harness.name': 'bot',
      'rule.threshold': '25',
      'event.title': 'bot has been blocked',
    });
    expect(
      await screen.findByText('Delivered. Check the destination for the message.'),
    ).toBeTruthy();
  });
});
