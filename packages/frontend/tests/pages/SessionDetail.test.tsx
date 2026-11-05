import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetSession = vi.fn();
vi.mock('../../src/services/api/sessions', () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
}));

const mockGetMessages = vi.fn();
vi.mock('../../src/services/api', () => ({
  getMessages: (...a: unknown[]) => mockGetMessages(...a),
}));

vi.mock('../../src/services/model-display', () => ({
  getModelDisplayName: (m: string) => 'disp:' + m,
  preloadModelDisplayNames: vi.fn(),
}));

vi.mock('../../src/components/MessageTable', () => ({
  default: (props: {
    items: Array<{ id: string }>;
    onRowSelect?: (id: string) => void;
    selectedRowId?: string | null;
  }) => (
    <ul data-testid="message-table" data-selected={props.selectedRowId ?? ''}>
      {props.items.map((m) => (
        <li key={m.id}>
          <button onClick={() => props.onRowSelect?.(m.id)}>row {m.id}</button>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('../../src/components/RequestDrawer', () => ({
  default: (props: { messageId: string | null; onClose: () => void }) =>
    props.messageId ? (
      <div role="dialog" aria-label="drawer">
        {props.messageId}
        <button onClick={props.onClose}>close drawer</button>
      </div>
    ) : null,
}));

import SessionDetail from '../../src/pages/SessionDetail';
import { resetLocaleForTests } from '../../src/i18n';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'ses_main',
  agent_id: 'a1',
  agent_name: 'claude-dev',
  started_at: iso(2 * 3_600_000 + 14 * 60_000),
  last_at: iso(60 * 60_000),
  requests: 1500,
  failed: 0,
  in_flight: 0,
  subagents: 0,
  input_tokens: 12000,
  output_tokens: 3400,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  cost: 1.234,
  models: ['m1'],
  providers: ['openai', 'anthropic'],
  parent_session_id: null,
  parts: [],
  client: null,
  ...over,
});

const row = (id: string) => ({ id });

function renderPage(id = 'ses_main') {
  return render(
    <MemoryRouter initialEntries={['/sessions/' + encodeURIComponent(id)]}>
      <Routes>
        <Route path="/sessions" element={<div>list page</div>} />
        <Route path="/sessions/:sessionId" element={<SessionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockGetSession.mockResolvedValue(detail());
  mockGetMessages.mockResolvedValue({
    items: [row('r1'), row('r2')],
    next_cursor: null,
    total_count: 2,
  });
});

afterEach(() => vi.useRealTimers());

describe('SessionDetail', () => {
  it('loads the session by the id in the URL', async () => {
    renderPage('ses/odd id');
    await screen.findByText('ses_main');
    expect(mockGetSession).toHaveBeenCalledWith('ses/odd id');
    expect(mockGetMessages).toHaveBeenCalledWith({
      session: 'ses/odd id',
      limit: '50',
      include_filter_options: 'false',
    });
  });

  it('shows a skeleton while the session loads, with the back link already visible', () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.skel')).not.toBeNull();
    expect(screen.getByRole('link', { name: '← Sessions' }).getAttribute('href')).toBe('/sessions');
  });

  it('renders the summary totals', async () => {
    renderPage();
    await screen.findByText('ses_main');
    const stat = (label: string) =>
      screen.getByText(label, { selector: '.text-xs' }).nextElementSibling!.textContent;
    expect(stat('Harness')).toBe('claude-dev');
    expect(stat('Duration')).toBe('1h 14m');
    expect(stat('Requests')).toBe('1.5k');
    expect(stat('Input tokens')).toBe('12k');
    expect(stat('Output tokens')).toBe('3.4k');
    expect(stat('Total cost')).toBe('$1.23');
  });

  it('keeps exact token counts in the tooltip of the abbreviated value', async () => {
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.getByText('12k').getAttribute('title')).toBe('12000');
    expect(screen.getByText('3.4k').getAttribute('title')).toBe('3400');
  });

  it('shows the document title for the session', async () => {
    renderPage();
    await screen.findByText('ses_main');
    expect(document.title).toBe('Session ses_main - Thinker');
  });

  it('lists models (display names) and providers', async () => {
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.getByText('disp:m1')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
  });

  it('shows the Active badge only for sessions with activity in the last five minutes', async () => {
    mockGetSession.mockResolvedValue(detail({ last_at: iso(60_000) }));
    const live = renderPage();
    await screen.findByText('ses_main');
    expect(screen.getByText('Active')).toBeTruthy();
    live.unmount();
    mockGetSession.mockResolvedValue(detail({ last_at: iso(30 * 60_000) }));
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('shows failed request counts next to the request total', async () => {
    mockGetSession.mockResolvedValue(detail({ failed: 4 }));
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.getByText('(4 failed)')).toBeTruthy();
  });

  it('hides optional lines when the data is absent', async () => {
    renderPage();
    await screen.findByText('ses_main');
    for (const label of ['Cache read', 'Client', 'Project', 'Main session']) {
      expect(screen.queryByText(label + ':')).toBeNull();
    }
    expect(screen.queryByText('Main session and subagents')).toBeNull();
  });

  it('shows cache reads, client, project and a link to the parent session', async () => {
    mockGetSession.mockResolvedValue(
      detail({
        cache_read_tokens: 5000,
        client: { user_agent: 'claude-cli/2.1', project: '/work/thinker', client: 'x' },
        parent_session_id: 'ses_parent/1',
      }),
    );
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.getByText('Cache read:').parentElement!.textContent).toContain('5k');
    expect(screen.getByText('claude-cli/2.1')).toBeTruthy();
    expect(screen.getByText('/work/thinker')).toBeTruthy();
    const parent = screen.getByRole('link', { name: 'ses_parent/1' });
    expect(parent.getAttribute('href')).toBe('/sessions/ses_parent%2F1');
  });

  it('omits client lines when the client is known but has no user agent or project', async () => {
    mockGetSession.mockResolvedValue(
      detail({ client: { user_agent: null, project: null, client: 'x' } }),
    );
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.queryByText('Client:')).toBeNull();
    expect(screen.queryByText('Project:')).toBeNull();
  });

  describe('main session and subagents', () => {
    const parts = [
      {
        session_id: 'ses_main',
        is_main: true,
        started_at: iso(3 * 3_600_000),
        last_at: iso(3_600_000),
        requests: 10,
        failed: 0,
        input_tokens: 100,
        output_tokens: 50,
        cost: 0.5,
      },
      {
        session_id: 'ses_sub/1',
        is_main: false,
        started_at: iso(2 * 3_600_000),
        last_at: iso(3_600_000 + 30_000),
        requests: 3,
        failed: 1,
        input_tokens: 10,
        output_tokens: 5,
        cost: 0.001,
      },
    ];

    it('is hidden for a single part', async () => {
      mockGetSession.mockResolvedValue(detail({ parts: [parts[0]] }));
      renderPage();
      await screen.findByText('ses_main');
      expect(screen.queryByText('Main session and subagents')).toBeNull();
    });

    it('lists the main session unlinked and subagents as links', async () => {
      mockGetSession.mockResolvedValue(detail({ parts }));
      renderPage();
      const heading = await screen.findByText('Main session and subagents');
      const table = heading.closest('section')!.querySelector('table')!;
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).queryByRole('link')).toBeNull();
      expect(within(rows[0]).getByText('Main')).toBeTruthy();
      const sub = within(rows[1]).getByRole('link');
      expect(sub.getAttribute('href')).toBe('/sessions/ses_sub%2F1');
      expect(within(rows[1]).getByText('Subagent')).toBeTruthy();
      expect(within(rows[1]).getByText('(1)')).toBeTruthy();
      expect(within(rows[1]).getByText('< $0.01')).toBeTruthy();
      expect(within(rows[1]).getByText('15')).toBeTruthy();
    });
  });

  describe('request list', () => {
    it('shows the first page of requests with the total', async () => {
      mockGetMessages.mockResolvedValue({
        items: [row('r1'), row('r2')],
        next_cursor: null,
        total_count: 2,
      });
      renderPage();
      await screen.findByTestId('message-table');
      expect(screen.getByText('Requests in this session')).toBeTruthy();
      expect(screen.getByText('2 total')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'row r1' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    });

    it('loads the next page with the cursor and appends it', async () => {
      mockGetMessages
        .mockResolvedValueOnce({ items: [row('r1')], next_cursor: 'c1', total_count: 3 })
        .mockResolvedValueOnce({
          items: [row('r2'), row('r3')],
          next_cursor: null,
          total_count: 3,
        });
      renderPage();
      await screen.findByRole('button', { name: 'row r1' });
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('button', { name: 'row r3' });
      expect(mockGetMessages).toHaveBeenLastCalledWith({
        session: 'ses_main',
        limit: '50',
        cursor: 'c1',
        include_total: 'false',
        include_filter_options: 'false',
      });
      expect(screen.getByRole('button', { name: 'row r1' })).toBeTruthy();
      expect(screen.getByText('3 total')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    });

    it('opens the request drawer for the chosen row and closes it again', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'row r2' }));
      expect(screen.getByRole('dialog', { name: 'drawer' }).textContent).toContain('r2');
      expect(screen.getByTestId('message-table').getAttribute('data-selected')).toBe('r2');
      fireEvent.click(screen.getByRole('button', { name: 'close drawer' }));
      expect(screen.queryByRole('dialog', { name: 'drawer' })).toBeNull();
    });

    it('shows an error with retry for the request list without hiding the summary', async () => {
      mockGetMessages.mockRejectedValueOnce(new Error('messages down'));
      renderPage();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('messages down');
      expect(screen.getByText('ses_main')).toBeTruthy();
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      await screen.findByTestId('message-table');
    });
  });

  describe('errors', () => {
    it('shows the error with retry when the session cannot be loaded', async () => {
      mockGetSession.mockRejectedValueOnce(new Error('Session not found'));
      renderPage('missing');
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Session not found');
      expect(screen.getByRole('link', { name: '← Sessions' })).toBeTruthy();
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      await screen.findByText('ses_main');
      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });

    it('does not claim a session loaded when only the requests did', async () => {
      mockGetSession.mockRejectedValue(new Error('nope'));
      renderPage();
      await screen.findAllByRole('alert');
      await waitFor(() => expect(mockGetMessages).toHaveBeenCalled());
      expect(screen.queryByText('Total cost')).toBeNull();
    });
  });

  it('renders the labels in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    renderPage();
    await screen.findByText('ses_main');
    expect(screen.queryByText('Total cost')).toBeNull();
    expect(screen.queryByText('Requests in this session')).toBeNull();
    expect(screen.getByText('Custo total')).toBeTruthy();
  });
});
