import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const mockGetAgents = vi.fn();
vi.mock('../../src/services/api', () => ({
  getAgents: (...a: unknown[]) => mockGetAgents(...a),
}));

const mockGetSessions = vi.fn();
vi.mock('../../src/services/api/sessions', () => ({
  getSessions: (...a: unknown[]) => mockGetSessions(...a),
}));

vi.mock('../../src/services/model-display', () => ({
  getModelDisplayName: (m: string) => 'disp:' + m,
  preloadModelDisplayNames: vi.fn(),
}));

import Sessions from '../../src/pages/Sessions';
import { resetLocaleForTests } from '../../src/i18n';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function session(over: Record<string, unknown> = {}) {
  return {
    id: 'ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    agent_id: 'a1',
    agent_name: 'claude-dev',
    started_at: iso(3 * 3_600_000),
    last_at: iso(60 * 60_000),
    requests: 1234,
    failed: 0,
    in_flight: 0,
    subagents: 0,
    input_tokens: 3000,
    output_tokens: 1500,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost: 2.5,
    models: ['gpt-5.5'],
    providers: ['openai'],
    ...over,
  };
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderPage(initial = '/sessions') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/sessions/:id" element={<div>detail page</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockGetAgents.mockResolvedValue({
    agents: [
      { agent_name: 'zeta', agent_platform: 'openclaw', agent_category: 'personal' },
      { agent_name: 'claude-dev', agent_platform: 'claude-code', agent_category: 'coding' },
    ],
  });
  mockGetSessions.mockResolvedValue({ items: [session()], has_more: false });
});

afterEach(() => vi.useRealTimers());

describe('Sessions page', () => {
  it('requests the last 7 days, 50 per page, with no harness filter by default', async () => {
    renderPage();
    await screen.findByText('claude-dev');
    expect(mockGetSessions).toHaveBeenCalledWith({
      range: '7d',
      agent_name: undefined,
      limit: '50',
      offset: '0',
    });
  });

  it('shows skeleton placeholders while loading', () => {
    mockGetSessions.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelectorAll('.skel')).toHaveLength(6);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders one row per session with the formatted columns', async () => {
    renderPage();
    const row = (await screen.findByText('claude-dev')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(within(cells[0]).getByRole('link').textContent).toBe('ses_aaaaaaaa…aaaaaa');
    expect(within(cells[0]).getByRole('link').getAttribute('href')).toBe(
      '/sessions/ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(cells[3].textContent).toBe('2h 0m');
    expect(cells[4].textContent).toBe('1.2k');
    expect(cells[5].textContent).toBe('4.5k');
    expect(cells[5].getAttribute('title')).toBe('3k in · 1.5k out');
    expect(cells[6].textContent).toBe('$2.50');
    expect(cells[7].textContent).toBe('disp:gpt-5.5');
    expect(cells[8].textContent).toBe('1h ago');
  });

  it('renders the column headers', async () => {
    renderPage();
    await screen.findByText('claude-dev');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'Session',
      'Harness',
      'Started',
      'Duration',
      'Requests',
      'Tokens',
      'Cost',
      'Models',
      'Last activity',
    ]);
  });

  it('flags a session active within five minutes, but not an older one', async () => {
    mockGetSessions.mockResolvedValue({
      items: [
        session({ id: 'live', last_at: iso(60_000), agent_name: 'a' }),
        session({ id: 'old', last_at: iso(10 * 60_000), agent_name: 'b' }),
      ],
      has_more: false,
    });
    renderPage();
    const live = (await screen.findByText('a')).closest('tr')!;
    const old = screen.getByText('b').closest('tr')!;
    expect(within(live).getByText('Active')).toBeTruthy();
    expect(within(old).queryByText('Active')).toBeNull();
  });

  it('shows subagent and failure counts, and collapses models beyond two', async () => {
    mockGetSessions.mockResolvedValue({
      items: [session({ subagents: 3, failed: 2, models: ['m1', 'm2', 'm3', 'm4'] })],
      has_more: false,
    });
    renderPage();
    const row = (await screen.findByText('claude-dev')).closest('tr')!;
    expect(within(row).getByText('+3 subagents')).toBeTruthy();
    expect(within(row).getByText('2 failed')).toBeTruthy();
    expect(within(row).getByText('disp:m1')).toBeTruthy();
    expect(within(row).getByText('disp:m2')).toBeTruthy();
    expect(within(row).queryByText('disp:m3')).toBeNull();
    const more = within(row).getByText('+2');
    expect(more.getAttribute('title')).toBe('m3, m4');
  });

  it('shows a dash when the harness is unknown and a $ floor for tiny costs', async () => {
    mockGetSessions.mockResolvedValue({
      items: [session({ agent_name: null, cost: 0.002 })],
      has_more: false,
    });
    renderPage();
    const row = (await screen.findByText('—')).closest('tr')!;
    expect(within(row).getByText('< $0.01')).toBeTruthy();
  });

  it('opens the detail page when the row is clicked, but not when its link is', async () => {
    renderPage();
    const row = (await screen.findByText('claude-dev')).closest('tr')!;
    fireEvent.click(within(row).getAllByRole('cell')[3]);
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe(
        '/sessions/ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    );
    expect(screen.getByText('detail page')).toBeTruthy();
  });

  it('encodes unusual session ids in the detail link', async () => {
    mockGetSessions.mockResolvedValue({ items: [session({ id: 'a/b c' })], has_more: false });
    renderPage();
    const link = await screen.findByRole('link', { name: 'a/b c' });
    expect(link.getAttribute('href')).toBe('/sessions/a%2Fb%20c');
  });

  describe('empty and error states', () => {
    it('explains how sessions appear when there are none', async () => {
      mockGetSessions.mockResolvedValue({ items: [], has_more: false });
      renderPage();
      expect(await screen.findByRole('heading', { name: 'No sessions yet' })).toBeTruthy();
      expect(screen.getByText(/Sessions appear when a harness names its session/)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    });

    it('shows the error with a retry that reloads', async () => {
      mockGetSessions.mockRejectedValueOnce(new Error('backend down'));
      renderPage();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('backend down');
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('claude-dev')).toBeTruthy();
      expect(mockGetSessions).toHaveBeenCalledTimes(2);
    });

    it('still lists sessions when the harness list fails to load', async () => {
      mockGetAgents.mockRejectedValue(new Error('no agents'));
      renderPage();
      expect(await screen.findByText('claude-dev')).toBeTruthy();
    });

    it('accepts the harness list as a bare array', async () => {
      mockGetAgents.mockResolvedValue([{ agent_name: 'solo' }]);
      renderPage();
      await screen.findByText('claude-dev');
      fireEvent.click(screen.getAllByRole('button', { name: /All harnesses/ })[0]);
      expect(screen.getByRole('option', { name: /solo/ })).toBeTruthy();
    });
  });

  describe('filters', () => {
    it('filters by harness through the query string, sorting the choices by name', async () => {
      renderPage();
      await screen.findByText('claude-dev');
      fireEvent.click(screen.getByRole('button', { name: /All harnesses/ }));
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(['All harnesses', 'claude-dev', 'zeta']);
      fireEvent.click(screen.getByRole('option', { name: 'zeta' }));
      await waitFor(() =>
        expect(screen.getByTestId('where').textContent).toBe('/sessions?agent=zeta'),
      );
      await waitFor(() =>
        expect(mockGetSessions).toHaveBeenLastCalledWith({
          range: '7d',
          agent_name: 'zeta',
          limit: '50',
          offset: '0',
        }),
      );
    });

    it('reads the range and harness from the URL', async () => {
      renderPage('/sessions?range=30d&agent=claude-dev');
      await screen.findByRole('table');
      expect(mockGetSessions).toHaveBeenCalledWith({
        range: '30d',
        agent_name: 'claude-dev',
        limit: '50',
        offset: '0',
      });
    });

    it('changes the range, and clearing the harness drops it from the URL', async () => {
      renderPage('/sessions?agent=zeta');
      await screen.findByText('claude-dev');
      fireEvent.click(screen.getByRole('button', { name: /7 days|Last 7 days|7d/i }));
      const ranges = screen.getAllByRole('option').map((o) => o.textContent);
      expect(ranges).toHaveLength(5);
      fireEvent.click(screen.getAllByRole('option')[0]);
      await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('range='));
      fireEvent.click(screen.getByRole('button', { name: /zeta/ }));
      fireEvent.click(screen.getByRole('option', { name: 'All harnesses' }));
      await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('agent='));
    });
  });

  describe('pagination', () => {
    it('hides the pager on a single short page', async () => {
      renderPage();
      await screen.findByText('claude-dev');
      expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    });

    it('pages forward and back with the right offsets', async () => {
      mockGetSessions.mockImplementation(async (p: { offset: string }) => ({
        items: [session({ id: 'page-' + p.offset, agent_name: 'on-' + p.offset })],
        has_more: p.offset === '0',
      }));
      renderPage();
      await screen.findByText('on-0');
      const prev = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement;
      const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
      expect(prev.disabled).toBe(true);
      expect(next.disabled).toBe(false);
      fireEvent.click(next);
      await screen.findByText('on-50');
      expect(mockGetSessions).toHaveBeenLastCalledWith(expect.objectContaining({ offset: '50' }));
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
      await screen.findByText('on-0');
    });

    it('returns to the first page when a filter changes', async () => {
      mockGetSessions.mockImplementation(async (p: { offset: string }) => ({
        items: [session({ agent_name: 'on-' + p.offset })],
        has_more: true,
      }));
      renderPage();
      await screen.findByText('on-0');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('on-50');
      fireEvent.click(screen.getByRole('button', { name: /All harnesses/ }));
      fireEvent.click(screen.getByRole('option', { name: 'zeta' }));
      await waitFor(() =>
        expect(mockGetSessions).toHaveBeenLastCalledWith(
          expect.objectContaining({ agent_name: 'zeta', offset: '0' }),
        ),
      );
    });
  });

  it('sets the document title and meta description', async () => {
    renderPage();
    await screen.findByText('claude-dev');
    expect(document.querySelector('title')!.textContent).toBe('Sessions - Thinker');
    expect(document.querySelector('meta[name="description"]')!.getAttribute('content')).toContain(
      'Harness sessions',
    );
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    mockGetSessions.mockResolvedValue({ items: [], has_more: false });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Nenhuma sessão ainda' })).toBeTruthy();
    expect(screen.queryByText('No sessions yet')).toBeNull();
  });
});
