import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockSet = vi.fn();
vi.mock('../../src/services/api/triggers.js', () => ({
  setHarnessTriggers: (...a: unknown[]) => mockSet(...a),
}));

import HarnessTriggersPanel from '../../src/components/triggers/HarnessTriggersPanel';

const triggers = [
  { id: 't1', name: 'ops-mail', type: 'email', enabled: true },
  { id: 't2', name: 'chat', type: 'telegram', enabled: false },
  { id: 't3', name: 'hook', type: 'webhook', enabled: true },
] as never;

function renderPanel(props: Partial<Parameters<typeof HarnessTriggersPanel>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <MemoryRouter>
      <HarnessTriggersPanel
        agentName="bot"
        triggers={triggers}
        bindings={[{ trigger_id: 't1', events: ['limit.alert'] }]}
        loading={false}
        canEdit
        onSaved={onSaved}
        {...props}
      />
    </MemoryRouter>,
  );
  return onSaved;
}

describe('HarnessTriggersPanel', () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockSet.mockImplementation((_a: string, b: unknown) => Promise.resolve(b));
  });

  it('adds several triggers at once with the default events, edits events and saves with one PUT', async () => {
    const onSaved = renderPanel();
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('ops-mail: Limit block'));
    fireEvent.click(screen.getByText('Add triggers'));
    fireEvent.click(screen.getByLabelText(/chat/));
    fireEvent.click(screen.getByLabelText(/hook/));
    fireEvent.click(screen.getByText('Add 2 triggers'));
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getAllByText('(Fires on every request.)').length).toBe(3);
    expect((screen.getByLabelText('chat: Request debug') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('Add triggers')).toBeNull();
    expect(screen.getByLabelText('Test chat').getAttribute('href')).toBe(
      '/triggers/test?trigger=t2&harness=bot',
    );

    fireEvent.click(save);
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));
    expect(mockSet).toHaveBeenCalledWith('bot', [
      { trigger_id: 't1', events: ['limit.alert', 'limit.block'] },
      {
        trigger_id: 't2',
        events: ['limit.alert', 'limit.block', 'provider.failure', 'credential.expired'],
      },
      {
        trigger_id: 't3',
        events: ['limit.alert', 'limit.block', 'provider.failure', 'credential.expired'],
      },
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('removes a binding', async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Remove ops-mail'));
    expect(screen.getByText(/No triggers bound to this harness/)).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('bot', []));
  });

  it('links to /triggers when the workspace has none', () => {
    renderPanel({ triggers: [], bindings: [] });
    expect(screen.getByText('Create a trigger').getAttribute('href')).toBe('/triggers');
  });

  it('is read-only without the edit-harness role', () => {
    renderPanel({ canEdit: false });
    expect((screen.getByLabelText('ops-mail: Limit alert') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByLabelText('Remove ops-mail')).toBeNull();
  });
});
