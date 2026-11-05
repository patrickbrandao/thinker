import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({
  listProxyAssignments: vi.fn(),
  listProxyProfiles: vi.fn(),
  setProxyAssignment: vi.fn(),
}));
vi.mock('../../../src/services/api/proxies.js', async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));

import ProviderDefaultsTab from '../../../src/components/proxy/ProviderDefaultsTab';
import { PROVIDERS } from '../../../src/services/providers';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { profile } from './fixtures';

const openai = PROVIDERS.find((p) => p.id === 'openai')!;
const anthropic = PROVIDERS.find((p) => p.id === 'anthropic')!;

const selectOf = (provider: string) =>
  screen.getByRole('button', { name: `Outbound for ${provider}` }) as HTMLButtonElement;

/** Every provider card shares one label shape, so look it up by the provider name. */
const labelsOf = (name: string) => screen.getAllByRole('button', { name: `Outbound for ${name}` });

function renderTab() {
  return render(
    <MemoryRouter>
      <ProviderDefaultsTab />
    </MemoryRouter>,
  );
}

const assignment = (mode: string, profileId: string | null, profileName: string | null = null) => ({
  target_type: 'provider',
  target_id: 'x',
  mode,
  profile_id: profileId,
  effective: { source: 'provider', mode, profile_name: profileName, chain: [] },
});

describe('ProviderDefaultsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listProxyAssignments.mockResolvedValue({
      assignments: [
        { target_type: 'provider', target_id: 'api_key:openai', mode: 'direct', profile_id: null, profile_name: null },
        { target_type: 'provider', target_id: 'subscription:anthropic', mode: 'profile', profile_id: 'pr1', profile_name: 'Primary route' },
      ],
      custom_providers: [
        { id: 'custom:abc', name: 'My Gateway', local_type: null },
        { id: 'custom:loc', name: 'Hidden local', local_type: 'ollama' },
      ],
    });
    api.listProxyProfiles.mockResolvedValue({ profiles: [profile()] });
    api.setProxyAssignment.mockResolvedValue(assignment('direct', null));
  });

  it('shows the three sections, local server types and custom providers', async () => {
    renderTab();
    await waitFor(() => expect(selectOf('Ollama').disabled).toBe(false));
    for (const heading of ['Local', 'Usage-based (API key)', 'Subscriptions']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(selectOf('LM Studio')).toBeTruthy();
    expect(selectOf('llama.cpp')).toBeTruthy();
    // Custom (non-local) providers join the usage-based list; local ones are covered by their type.
    expect(selectOf('My Gateway')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Outbound for Hidden local' })).toBeNull();
  });

  it('reflects the stored mode per provider and defaults to the global option', async () => {
    renderTab();
    await waitFor(() => expect(selectOf('Ollama').disabled).toBe(false));
    expect(selectOf('Ollama').textContent).toContain('Global default');
    // OpenAI's API-key row is direct; its other rows (if any) stay on global.
    const openaiSelects = labelsOf(openai.name);
    expect(openaiSelects[0]!.textContent).toContain('Direct - no proxy');
    const anthropicSelects = labelsOf(anthropic.name);
    expect(anthropicSelects.some((s) => s.textContent?.includes('Profile: Primary route'))).toBe(true);
  });

  it('keeps the selects disabled until assignments load', async () => {
    let release!: (v: unknown) => void;
    api.listProxyAssignments.mockReturnValue(new Promise((r) => (release = r)));
    renderTab();
    await waitFor(() => expect(selectOf('Ollama')).toBeTruthy());
    expect(selectOf('Ollama').disabled).toBe(true);
    release({ assignments: [], custom_providers: [] });
    await waitFor(() => expect(selectOf('Ollama').disabled).toBe(false));
  });

  it('sets a local type to Direct with a provider-scoped target id', async () => {
    renderTab();
    await waitFor(() => expect(selectOf('Ollama').disabled).toBe(false));
    fireEvent.click(selectOf('Ollama'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Direct - no proxy' }));
    await waitFor(() =>
      expect(api.setProxyAssignment).toHaveBeenCalledWith('provider', 'local:ollama', 'direct', null),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Outbound proxy saved');
    await waitFor(() => expect(selectOf('Ollama').textContent).toContain('Direct - no proxy'));
  });

  it('sets a profile and shows its name', async () => {
    api.setProxyAssignment.mockResolvedValue(assignment('profile', 'pr1', 'Primary route'));
    renderTab();
    await waitFor(() => expect(selectOf('LM Studio').disabled).toBe(false));
    fireEvent.click(selectOf('LM Studio'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile: Primary route' }));
    await waitFor(() =>
      expect(api.setProxyAssignment).toHaveBeenCalledWith('provider', 'local:lmstudio', 'profile', 'pr1'),
    );
    await waitFor(() => expect(selectOf('LM Studio').textContent).toContain('Profile: Primary route'));
  });

  it('going back to the global default stores "inherit" and drops the row', async () => {
    api.setProxyAssignment.mockResolvedValue(assignment('inherit', null));
    renderTab();
    await waitFor(() => expect(labelsOf(openai.name)[0]!.textContent).toContain('Direct'));
    const apiKeySelect = labelsOf(openai.name)[0]!;
    fireEvent.click(apiKeySelect);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Global default' }));
    await waitFor(() =>
      expect(api.setProxyAssignment).toHaveBeenCalledWith('provider', 'api_key:openai', 'inherit', null),
    );
    await waitFor(() => expect(labelsOf(openai.name)[0]!.textContent).toContain('Global default'));
  });

  it('does not change the shown value when the save fails', async () => {
    api.setProxyAssignment.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => expect(selectOf('Ollama').disabled).toBe(false));
    fireEvent.click(selectOf('Ollama'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Direct - no proxy' }));
    await waitFor(() => expect(api.setProxyAssignment).toHaveBeenCalled());
    await waitFor(() => expect(selectOf('Ollama').disabled).toBe(false));
    expect(selectOf('Ollama').textContent).toContain('Global default');
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('shows the error and retries', async () => {
    api.listProxyAssignments.mockRejectedValueOnce(new Error('assignments down'));
    renderTab();
    expect(await screen.findByText('assignments down')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(selectOf('Ollama')).toBeTruthy());
    expect(api.listProxyAssignments).toHaveBeenCalledTimes(2);
  });

  it('asks for the provider level assignments only', async () => {
    renderTab();
    await waitFor(() => expect(api.listProxyAssignments).toHaveBeenCalledWith('provider'));
  });

  it('renders in pt-BR', async () => {
    resetLocaleForTests('pt-BR');
    renderTab();
    const label = t('proxies.providerDefaults.selectLabel', { provider: 'Ollama' });
    await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeTruthy());
    expect(label).not.toBe('Outbound for Ollama');
    expect(screen.getByRole('heading', { name: t('proxies.providerDefaults.subscriptions') })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: label });
    expect(within(trigger).getByText(t('proxies.assignment.global'))).toBeTruthy();
  });
});
