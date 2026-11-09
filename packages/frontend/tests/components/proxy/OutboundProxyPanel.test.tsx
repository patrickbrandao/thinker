import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  getProxyAssignment: vi.fn(),
  listProxyProfiles: vi.fn(),
  setProxyAssignment: vi.fn(),
}));
vi.mock('../../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

import OutboundProxyPanel, {
  chainText,
  EffectiveProxyBadge,
  modeLabel,
} from '../../../src/components/proxy/OutboundProxyPanel';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { profile } from './fixtures';

function assignment(over: Record<string, unknown> = {}) {
  return {
    target_type: 'trigger',
    target_id: 't1',
    mode: 'inherit',
    profile_id: null,
    effective: { source: 'global', mode: 'global', chain: [], global: null },
    ...over,
  };
}

function renderPanel(props: Partial<Parameters<typeof OutboundProxyPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <OutboundProxyPanel targetType="trigger" targetId="t1" canManage {...props} />
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByRole('button', { name: 'Proxy mode' }) as HTMLButtonElement;
const saveBtn = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('helpers', () => {
  it('modeLabel and chainText', () => {
    expect(modeLabel('direct')).toBe('Direct - no proxy');
    expect(modeLabel('global')).toBe('Global default');
    expect(modeLabel('profile', 'Edge')).toBe('Profile: Edge');
    expect(modeLabel('profile')).toBe('Profile: ?');
    expect(chainText(profile().chain)).toBe('Alpha → Direct');
  });

  it('EffectiveProxyBadge describes the effective path', () => {
    const { rerender, container } = render(
      <EffectiveProxyBadge
        assignment={assignment({ effective: { source: 'global', mode: 'global', chain: [], global: null } }) as never}
      />,
    );
    expect(container.textContent).toBe('Global default (no global proxy set: direct)');
    rerender(
      <EffectiveProxyBadge
        assignment={assignment({ effective: { source: 'global', mode: 'global', chain: [], global: 'http://corp:3128' } }) as never}
      />,
    );
    expect(container.textContent).toBe('Global default');
    expect(container.querySelector('.badge')!.getAttribute('title')).toBe('http://corp:3128');
    rerender(
      <EffectiveProxyBadge
        assignment={assignment({
          effective: { source: 'trigger', mode: 'profile', profile_name: 'Edge', chain: profile().chain },
        }) as never}
      />,
    );
    expect(container.textContent).toBe('Profile: Edge (Alpha → Direct)');
  });
});

describe('OutboundProxyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProxyAssignment.mockResolvedValue(assignment());
    api.listProxyProfiles.mockResolvedValue({ profiles: [profile()] });
    api.setProxyAssignment.mockResolvedValue(assignment({ mode: 'direct' }));
  });

  it('loads the assignment of the target and shows the effective path', async () => {
    renderPanel();
    expect(screen.getByText('Loading...')).toBeTruthy();
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    expect(api.getProxyAssignment).toHaveBeenCalledWith('trigger', 't1');
    expect(screen.getByText('Effective:')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Outbound proxy' })).toBeTruthy();
  });

  it('renders nothing when the assignment cannot be loaded or is malformed', async () => {
    api.getProxyAssignment.mockRejectedValue(new Error('old backend'));
    const { container, unmount } = renderPanel();
    await waitFor(() => expect(api.getProxyAssignment).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
    unmount();
    api.getProxyAssignment.mockResolvedValue({ mode: 'inherit' });
    const second = renderPanel();
    await waitFor(() => expect(api.getProxyAssignment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.container.textContent).toBe(''));
  });

  it('save is disabled until the mode changes; saving sends mode and profile id', async () => {
    renderPanel();
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    expect(saveBtn().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile: Primary route' }));
    expect(saveBtn().disabled).toBe(false);
    expect(trigger().textContent).toContain('Profile: Primary route');

    api.setProxyAssignment.mockResolvedValue(
      assignment({ mode: 'profile', profile_id: 'pr1', effective: { source: 'trigger', mode: 'profile', profile_name: 'Primary route', chain: profile().chain } }),
    );
    fireEvent.click(saveBtn());
    await waitFor(() =>
      expect(api.setProxyAssignment).toHaveBeenCalledWith('trigger', 't1', 'profile', 'pr1'),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Outbound proxy saved');
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
    expect(screen.getByText('Profile: Primary route (Alpha → Direct)')).toBeTruthy();
  });

  it('sends direct without a profile id', async () => {
    renderPanel();
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Direct - no proxy' }));
    fireEvent.click(saveBtn());
    await waitFor(() =>
      expect(api.setProxyAssignment).toHaveBeenCalledWith('trigger', 't1', 'direct', null),
    );
  });

  it('cancel restores the saved value', async () => {
    renderPanel();
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Direct - no proxy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(trigger().textContent).toContain('Global default');
    expect(saveBtn().disabled).toBe(true);
    expect(api.setProxyAssignment).not.toHaveBeenCalled();
  });

  it('for a trigger, inherit means the global proxy and the global option is not repeated', async () => {
    renderPanel();
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    fireEvent.click(trigger());
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['Global default', 'Direct - no proxy', 'Profile: Primary route']);
  });

  it('for a connection, inherit names the provider default and a separate global option exists', async () => {
    api.getProxyAssignment.mockResolvedValue(
      assignment({
        target_type: 'connection',
        target_id: 'c1',
        inherited: { target_id: 'api_key:openai', mode: 'profile', profile_id: 'pr1', profile_name: 'Primary route' },
      }),
    );
    renderPanel({ targetType: 'connection', targetId: 'c1' });
    await waitFor(() =>
      expect(trigger().textContent).toContain('Provider default (Profile: Primary route)'),
    );
    fireEvent.click(trigger());
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Provider default (Profile: Primary route)',
      'Global default',
      'Direct - no proxy',
      'Profile: Primary route',
    ]);
  });

  it('is read-only without manage rights: select disabled, no save, no profile hint', async () => {
    api.listProxyProfiles.mockResolvedValue({ profiles: [] });
    renderPanel({ canManage: false });
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    expect(trigger().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByText(/No outbound profiles yet/)).toBeNull();
  });

  it('links to profile management when there are no profiles', async () => {
    api.listProxyProfiles.mockResolvedValue({ profiles: [] });
    renderPanel();
    expect(await screen.findByText(/No outbound profiles yet\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe(
      '/proxy-servers?tab=profiles',
    );
  });

  it('keeps the unsaved choice when the save fails', async () => {
    api.setProxyAssignment.mockRejectedValue(new Error('denied'));
    renderPanel();
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Direct - no proxy' }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(api.setProxyAssignment).toHaveBeenCalled());
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    expect(trigger().textContent).toContain('Direct - no proxy');
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('bare mode uses a plain label instead of the panel frame, with a custom title and description', async () => {
    const { container } = renderPanel({ bare: true, title: 'Outbound for this trigger', description: 'Where deliveries go.' });
    await waitFor(() => expect(trigger().textContent).toContain('Global default'));
    expect(container.querySelector('section.panel')).toBeNull();
    expect(screen.getByText('Outbound for this trigger')).toBeTruthy();
    expect(screen.getByText('Where deliveries go.')).toBeTruthy();
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    renderPanel();
    const label = t('proxies.binding.mode');
    await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeTruthy());
    expect(screen.getByText(t('proxies.binding.effectiveLabel'))).toBeTruthy();
    expect(t('proxies.binding.effectiveLabel')).not.toBe('Effective:');
    expect(screen.getByRole('heading', { name: t('proxies.binding.title') })).toBeTruthy();
  });
});
