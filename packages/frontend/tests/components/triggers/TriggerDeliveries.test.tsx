import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listTriggerEvents: vi.fn(),
  getTriggerEvent: vi.fn(),
  retryTriggerEvent: vi.fn(),
}));
vi.mock('../../../src/services/api/triggers.js', () => api);

import TriggerDeliveries, { statusLabel } from '../../../src/components/triggers/TriggerDeliveries';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { deliveryLog, emailTrigger, eventDetail, eventItem, webhookTrigger } from './fixtures';

const triggers = [webhookTrigger(), emailTrigger()];

function renderTab() {
  return render(
    <MemoryRouter>
      <TriggerDeliveries triggers={triggers} />
    </MemoryRouter>,
  );
}

const lastList = () => api.listTriggerEvents.mock.calls.at(-1)![0];
/** Cell text inside the deliveries table (trigger names also appear as filter options). */
const cell = async (text: string) => within(await screen.findByRole('table')).findByText(text);
const row = (text: string) => within(screen.getByRole('table')).getByText(text).closest('tr')!;

describe('statusLabel', () => {
  it('translates statuses and keeps unknown ones', () => {
    expect(statusLabel('pending')).toBe('Pending');
    expect(statusLabel('delivering')).toBe('Delivering');
    expect(statusLabel('delivered')).toBe('Delivered');
    expect(statusLabel('failed')).toBe('Failed');
    expect(statusLabel('exploded')).toBe('exploded');
  });
});

describe('TriggerDeliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTriggerEvents.mockResolvedValue([eventItem()]);
    api.getTriggerEvent.mockResolvedValue(eventDetail());
    api.retryTriggerEvent.mockResolvedValue({ ok: true });
  });

  it('loads the newest 50 events without filters', async () => {
    renderTab();
    await cell('ops-hook');
    expect(api.listTriggerEvents).toHaveBeenCalledTimes(1);
    expect(lastList()).toEqual({ trigger_id: undefined, status: undefined, event_type: undefined, limit: 50 });
  });

  it('shows each delivery with trigger, event, harness, status, attempts and last error', async () => {
    api.listTriggerEvents.mockResolvedValue([
      eventItem(),
      eventItem({
        id: 'e2',
        trigger_id: null,
        trigger_name: 'old-mail',
        trigger_type: 'email',
        event_type: 'provider.failure',
        agent_name: null,
        status: 'failed',
        attempts: 4,
        last_error: 'SMTP refused',
      }),
    ]);
    renderTab();
    const ok = (await cell('ops-hook')).closest('tr')!;
    expect(within(ok).getByText('Limit alert')).toBeTruthy();
    expect(within(ok).getByText('my-bot')).toBeTruthy();
    expect(within(ok).getByText('Delivered')).toBeTruthy();
    expect(within(ok).getByText('1')).toBeTruthy();
    expect(within(ok).queryByText('(deleted)')).toBeNull();

    const failed = row('old-mail');
    expect(within(failed).getByText('(deleted)')).toBeTruthy();
    expect(within(failed).getByText('Provider failure')).toBeTruthy();
    expect(within(failed).getByText('—')).toBeTruthy();
    expect(within(failed).getByText('Failed')).toBeTruthy();
    expect(within(failed).getByText('4')).toBeTruthy();
    expect(within(failed).getByText('SMTP refused').getAttribute('title')).toBe('SMTP refused');
  });

  it('filters by trigger, status and event type', async () => {
    renderTab();
    await cell('ops-hook');
    const triggerSelect = screen.getByLabelText('Trigger') as HTMLSelectElement;
    expect(Array.from(triggerSelect.options).map((o) => o.textContent)).toEqual(['All triggers', 'ops-hook', 'ops-mail']);
    fireEvent.change(triggerSelect, { target: { value: 't2' } });
    await waitFor(() => expect(lastList().trigger_id).toBe('t2'));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    await waitFor(() => expect(lastList().status).toBe('failed'));
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'limit.block' } });
    await waitFor(() => expect(lastList().event_type).toBe('limit.block'));
    expect(lastList()).toEqual({ trigger_id: 't2', status: 'failed', event_type: 'limit.block', limit: 50 });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    await waitFor(() => expect(lastList().status).toBeUndefined());
  });

  it('offers every status and a labelled event type', async () => {
    renderTab();
    await cell('ops-hook');
    const statuses = Array.from((screen.getByLabelText('Status') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(statuses).toEqual(['All statuses', 'Pending', 'Delivering', 'Delivered', 'Failed']);
    const events = Array.from((screen.getByLabelText('Event') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(events[0]).toBe('All events');
    expect(events).toContain('Credential expired');
    expect(events).toContain('Harness created');
  });

  it('shows an empty state, and an error with retry', async () => {
    api.listTriggerEvents.mockResolvedValueOnce([]);
    renderTab();
    expect(await screen.findByText('No deliveries')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    api.listTriggerEvents.mockRejectedValueOnce(new Error('queue unreachable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('queue unreachable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await cell('ops-hook')).toBeTruthy();
  });

  it('shows Load more only for a full page, pages by created_at and skips duplicates', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      eventItem({ id: `e${i}`, trigger_name: `hook-${i}`, created_at: `2026-10-02T10:${String(59 - i).padStart(2, '0')}:00.000Z` }),
    );
    api.listTriggerEvents.mockResolvedValueOnce(page1);
    renderTab();
    await screen.findByText('hook-0');
    api.listTriggerEvents.mockResolvedValueOnce([page1[49], eventItem({ id: 'extra', trigger_name: 'hook-extra' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('hook-extra');
    expect(lastList().before).toBe(page1[49]!.created_at);
    expect(screen.getAllByText('hook-49')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('does not offer Load more for a short page', async () => {
    renderTab();
    await cell('ops-hook');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('rows are keyboard operable and open the detail with Enter and Space', async () => {
    renderTab();
    const tr = (await cell('ops-hook')).closest('tr')!;
    expect(tr.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(tr, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Delivery' })).toBeTruthy();
    expect(api.getTriggerEvent).toHaveBeenCalledWith('e1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(tr, { key: ' ' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(tr, { key: 'a' });
  });

  describe('detail dialog', () => {
    const open = async () => {
      renderTab();
      fireEvent.click((await cell('ops-hook')).closest('tr')!);
      return screen.findByRole('dialog', { name: 'Delivery' });
    };

    it('shows the event, its variables and each attempt', async () => {
      api.getTriggerEvent.mockResolvedValue(
        eventDetail(
          { status: 'failed', last_error: 'HTTP 502', delivered_at: null, next_attempt_at: '2026-10-02T10:05:00.000Z' },
          [
            deliveryLog({ id: 'a1', attempt: 1, success: false, status_code: 502, error: 'Bad gateway', response: 'upstream down', duration_ms: 1200 }),
            deliveryLog({ id: 'a2', attempt: 2, success: true, status_code: 200, error: null, duration_ms: 80 }),
          ],
          { 'event.title': 'Limit exceeded', 'harness.name': 'my-bot' },
        ),
      );
      const dialog = await open();
      await within(dialog).findByText('Limit exceeded');
      expect(within(dialog).getByText('event.title')).toBeTruthy();
      expect(within(dialog).getByText('harness.name')).toBeTruthy();
      expect(within(dialog).getByText('Attempt 1')).toBeTruthy();
      expect(within(dialog).getByText('Attempt 2')).toBeTruthy();
      // Once as the event's last error, once as the attempt's status code badge.
      expect(within(dialog).getAllByText('HTTP 502')).toHaveLength(2);
      expect(within(dialog).getByText('Error: Bad gateway')).toBeTruthy();
      expect(within(dialog).getByText('upstream down').tagName).toBe('PRE');
      expect(within(dialog).getByText(/Next attempt/)).toBeTruthy();
      // The delivery status badge and the failed attempt's badge.
      expect(within(dialog).getAllByText('Failed', { selector: '.badge' })).toHaveLength(2);
      expect(within(dialog).getByText('OK', { selector: '.badge' })).toBeTruthy();
      // Duration is formatted per attempt.
      expect(within(dialog).getByText(/·\s*1\.2s/)).toBeTruthy();
      expect(within(dialog).getByText(/·\s*80ms/)).toBeTruthy();
    });

    it('says so when there are no variables or attempts yet', async () => {
      api.getTriggerEvent.mockResolvedValue(eventDetail({ status: 'pending' }, [], {}));
      const dialog = await open();
      expect(await within(dialog).findByText('No variables.')).toBeTruthy();
      expect(within(dialog).getByText('No attempts yet.')).toBeTruthy();
    });

    it('names where an attempt left Thinker: one egress, or every hop of a chain', async () => {
      api.getTriggerEvent.mockResolvedValue(
        eventDetail({}, [
          deliveryLog({ id: 'a1', attempt: 1, egress: { kind: 'direct', proxy_id: null, name: null } }),
          deliveryLog({
            id: 'a2',
            attempt: 2,
            egress: { kind: 'proxy', proxy_id: 'p2', name: 'Beta' },
            egress_hops: [
              { kind: 'proxy', proxy_id: 'p1', name: 'Alpha', position: 0, result: 'timeout', ms: 10000, tunnel_ms: null, status: null },
              { kind: 'proxy', proxy_id: 'p2', name: 'Beta', position: 1, result: 'ok', ms: 120, tunnel_ms: 20, status: 200 },
            ],
          }),
        ]),
      );
      const dialog = await open();
      await within(dialog).findByText('Attempt 2');
      const items = within(dialog).getAllByRole('listitem');
      expect(within(items[0]!).getByText('Direct')).toBeTruthy();
      expect(within(items[0]!).queryAllByRole('link')).toHaveLength(0);
      expect(within(items[1]!).getByRole('link', { name: 'Alpha' }).getAttribute('href')).toBe('/proxy-servers/p1');
      expect(within(items[1]!).getByRole('link', { name: 'Beta' })).toBeTruthy();
      expect(within(items[1]!).getByText('Timeout')).toBeTruthy();
    });

    it('offers Retry only for failed deliveries', async () => {
      for (const status of ['delivered', 'pending', 'delivering'] as const) {
        api.getTriggerEvent.mockResolvedValue(eventDetail({ status }));
        const { unmount } = render(
          <MemoryRouter>
            <TriggerDeliveries triggers={triggers} />
          </MemoryRouter>,
        );
        fireEvent.click((await cell('ops-hook')).closest('tr')!);
        const dialog = await screen.findByRole('dialog');
        await within(dialog).findByText('Attempt 1');
        expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
        unmount();
      }
    });

    it('retries a failed delivery, says it was queued again and refreshes both views', async () => {
      api.getTriggerEvent.mockResolvedValue(eventDetail({ status: 'failed', last_error: 'x' }));
      const dialog = await open();
      const retry = await within(dialog).findByRole('button', { name: 'Retry' });
      fireEvent.click(retry);
      await waitFor(() => expect(api.retryTriggerEvent).toHaveBeenCalledWith('e1'));
      expect(toastMock.success).toHaveBeenCalledWith('Delivery queued again');
      await waitFor(() => expect(api.listTriggerEvents).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(api.getTriggerEvent).toHaveBeenCalledTimes(2));
    });

    it('does nothing visible when the retry is refused', async () => {
      api.getTriggerEvent.mockResolvedValue(eventDetail({ status: 'failed' }));
      api.retryTriggerEvent.mockRejectedValue(new Error('not retryable'));
      const dialog = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(api.retryTriggerEvent).toHaveBeenCalled());
      await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false));
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(api.listTriggerEvents).toHaveBeenCalledTimes(1);
    });

    it('shows a load error inside the dialog with a retry', async () => {
      api.getTriggerEvent.mockRejectedValueOnce(new Error('event purged'));
      const dialog = await open();
      expect(await within(dialog).findByText('event purged')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
      expect(await within(dialog).findByText('Attempt 1')).toBeTruthy();
    });

    it('shows loading, then switches to the data of the newly picked event only', async () => {
      let release!: (v: unknown) => void;
      api.getTriggerEvent.mockReturnValue(new Promise((r) => (release = r)));
      const dialog = await open();
      expect(within(dialog).getByText('Loading...')).toBeTruthy();
      release(eventDetail());
      expect(await within(dialog).findByText('Attempt 1')).toBeTruthy();
    });
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    api.listTriggerEvents.mockResolvedValue([eventItem({ status: 'failed' })]);
    api.getTriggerEvent.mockResolvedValue(eventDetail({ status: 'failed' }));
    renderTab();
    const tr = (await cell('ops-hook')).closest('tr')!;
    expect(within(tr).getByText(t('triggers.deliveries.statuses.failed'))).toBeTruthy();
    expect(t('triggers.deliveries.statuses.failed')).not.toBe('Failed');
    expect(screen.getByLabelText(t('triggers.deliveries.status'))).toBeTruthy();
    fireEvent.click(tr);
    const dialog = await screen.findByRole('dialog', { name: t('triggers.deliveries.detail.title') });
    expect(await within(dialog).findByRole('button', { name: t('triggers.deliveries.detail.retry') })).toBeTruthy();
  });
});
