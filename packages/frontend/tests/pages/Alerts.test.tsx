import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockList = vi.fn();
const mockRead = vi.fn();
const mockReadAll = vi.fn();
vi.mock('../../src/services/api/alerts', () => ({
  listAlertEvents: (...a: unknown[]) => mockList(...a),
  markAlertRead: (...a: unknown[]) => mockRead(...a),
  markAllAlertsRead: (...a: unknown[]) => mockReadAll(...a),
}));
const mockGetAlerts = vi.fn();
vi.mock('../../src/services/api/console', () => ({
  getAlerts: (...a: unknown[]) => mockGetAlerts(...a),
}));

import Alerts from '../../src/pages/Alerts';
import { resetLocaleForTests } from '../../src/i18n';

function event(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    tenant_id: 't1',
    level: 'error',
    category: 'triggers',
    type: 'trigger.failed',
    title: 'Trigger "Hook" failed to deliver limit.block',
    message: 'Gave up after 4 attempts: HTTP 500',
    entity_type: 'trigger',
    entity_id: 'trig-1',
    entity_name: 'Hook',
    actor_user_id: null,
    actor_email: null,
    actor_ip: null,
    actor_user_agent: null,
    metadata: {},
    created_at: '2026-11-05T12:00:00Z',
    read_at: null,
    read_by_user_id: null,
    read_by_email: null,
    read_by_name: null,
    ...over,
  };
}

const page = (events: unknown[], unread = events.length) => ({
  events,
  total: events.length,
  unread,
  page: 1,
  limit: 25,
});

describe('Alerts page', () => {
  beforeEach(() => {
    resetLocaleForTests();
    mockList.mockReset();
    mockRead.mockReset().mockResolvedValue(undefined);
    mockReadAll.mockReset().mockResolvedValue({ updated: 1 });
    mockGetAlerts.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  it('lists events and marks one as read for everyone', async () => {
    mockList.mockResolvedValue(
      page(
        [
          event(),
          event({
            id: 'e2',
            level: 'info',
            category: 'audit',
            type: 'audit.updated',
            title: 'Trigger Hook updated',
            actor_email: 'ana@x.io',
            actor_ip: '203.0.113.7',
            read_at: '2026-11-05T13:00:00Z',
            read_by_name: 'Ana',
          }),
        ],
        1,
      ),
    );
    render(
      <MemoryRouter initialEntries={['/alerts']}>
        <Alerts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Trigger "Hook" failed to deliver limit.block')).toBeTruthy();
    expect(screen.getByText('ana@x.io')).toBeTruthy();
    expect(screen.getByText(/Read by Ana on/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('e1'));
  });

  it('marks every visible alert as read with the current filters', async () => {
    mockList.mockResolvedValue(page([event()]));
    render(
      <MemoryRouter initialEntries={['/alerts?level=error']}>
        <Alerts />
      </MemoryRouter>,
    );
    await screen.findByText('Trigger "Hook" failed to deliver limit.block');
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', page: 1 }));
    fireEvent.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() => expect(mockReadAll).toHaveBeenCalledWith({ level: 'error', category: '' }));
  });

  it('shows the failed requests tab', async () => {
    mockList.mockResolvedValue(page([]));
    mockGetAlerts.mockResolvedValue({
      items: [
        {
          id: 'r1',
          timestamp: '2026-11-05T12:00:00Z',
          agentName: 'bot',
          model: 'gpt-5',
          status: 'error',
          errorMessage: 'upstream timeout',
          errorHttpStatus: 504,
          errorClass: 'timeout',
        },
      ],
      total: 1,
    });
    render(
      <MemoryRouter initialEntries={['/alerts?view=requests']}>
        <Alerts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('HTTP 504 · timeout')).toBeTruthy();
    expect(screen.getByText('upstream timeout')).toBeTruthy();
  });
});
