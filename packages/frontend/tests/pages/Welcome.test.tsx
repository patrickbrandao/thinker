import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { resetLocaleForTests } from '../../src/i18n';

const api = vi.hoisted(() => ({
  getPlaygroundAgent: vi.fn(),
  getProviders: vi.fn(),
  getCustomProviders: vi.fn(),
  getAgents: vi.fn(),
  getAvailableModels: vi.fn(),
  getTierAssignments: vi.fn(),
  listModelParams: vi.fn(),
  refreshModels: vi.fn(),
  createAgent: vi.fn(),
  getAgentKey: vi.fn(),
  deleteModelParams: vi.fn(),
  setModelParams: vi.fn(),
}));
vi.mock('../../src/services/api', async (orig) => ({
  ...(await orig<object>()),
  getPlaygroundAgent: (...a: unknown[]) => api.getPlaygroundAgent(...a),
  getProviders: (...a: unknown[]) => api.getProviders(...a),
  getCustomProviders: (...a: unknown[]) => api.getCustomProviders(...a),
  getAgents: (...a: unknown[]) => api.getAgents(...a),
  getAvailableModels: (...a: unknown[]) => api.getAvailableModels(...a),
  getTierAssignments: (...a: unknown[]) => api.getTierAssignments(...a),
  listModelParams: (...a: unknown[]) => api.listModelParams(...a),
  refreshModels: (...a: unknown[]) => api.refreshModels(...a),
  createAgent: (...a: unknown[]) => api.createAgent(...a),
  getAgentKey: (...a: unknown[]) => api.getAgentKey(...a),
  deleteModelParams: (...a: unknown[]) => api.deleteModelParams(...a),
  setModelParams: (...a: unknown[]) => api.setModelParams(...a),
}));

const mockGetMessages = vi.fn();
vi.mock('../../src/services/api/messages.js', () => ({
  getMessages: (...a: unknown[]) => mockGetMessages(...a),
}));

let mockUserId: string | undefined = 'u1';
vi.mock('../../src/services/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: mockUserId ? { user: { id: mockUserId } } : null,
      isPending: false,
    }),
  },
}));

vi.mock('../../src/components/ProviderIcon', () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

let selectProps: Record<string, any> = {};
vi.mock('../../src/components/AgentTypeSelect', () => ({
  default: (props: Record<string, any>) => {
    selectProps = props;
    return (
      <div data-testid="type-select" data-category={props.category} data-platform={props.platform}>
        <button onClick={() => props.onCategoryChange('coding')}>category coding</button>
        <button onClick={() => props.onPlatformChange('codex')}>platform codex</button>
      </div>
    );
  },
}));

let setupProps: Record<string, any> = {};
vi.mock('../../src/components/SetupStepAddProvider', () => ({
  default: (props: Record<string, any>) => {
    setupProps = props;
    return <div data-testid="setup-instructions" />;
  },
}));

let providerModalProps: Record<string, any> | null = null;
vi.mock('../../src/components/ProviderSelectModal', () => ({
  default: (props: Record<string, any>) => {
    providerModalProps = props;
    return (
      <div role="dialog" aria-label="connect modal">
        <button onClick={() => props.onUpdate()}>modal update</button>
        <button onClick={props.onClose}>modal close</button>
      </div>
    );
  },
}));

let routingModalsProps: Record<string, any> | null = null;
vi.mock('../../src/components/RoutingModals', () => ({
  default: (props: Record<string, any>) => {
    routingModalsProps = props;
    return null;
  },
}));

let tierSectionProps: Record<string, any> | null = null;
vi.mock('../../src/pages/RoutingDefaultTierSection', () => ({
  default: (props: Record<string, any>) => {
    tierSectionProps = props;
    return <div data-testid="tier-section" />;
  },
}));

vi.mock('../../src/pages/Playground', () => ({
  default: () => <div data-testid="playground" />,
}));

let defaultTier: Record<string, unknown> | undefined;
vi.mock('../../src/pages/RoutingActions', () => ({
  useRoutingActions: () => ({
    getTier: (id: string) => (id === 'default' ? defaultTier : undefined),
    getFallbacksFor: () => [],
    handleOverride: vi.fn(),
    handleAddFallback: vi.fn(),
    handlePinKey: vi.fn(),
    handleReset: vi.fn(),
    handleFallbackUpdate: vi.fn(),
    changingTier: null,
    resettingTier: null,
    resettingAll: false,
    addingFallback: null,
  }),
}));

vi.mock('../../src/pages/WelcomeLiftoff', () => ({
  default: (props: { onLeave: () => void; harnessSlug: string }) => (
    <div role="dialog" aria-label="liftoff">
      {props.harnessSlug}
      <button onClick={props.onLeave}>liftoff leave</button>
    </div>
  ),
}));

import Welcome from '../../src/pages/Welcome';
import { RightSidebarProvider } from '../../src/services/right-sidebar';
import { hasOnboardingBeenDone, markOnboardingDone } from '../../src/services/onboarding';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderWelcome(initial = '/welcome') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <RightSidebarProvider>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/" element={<div>dashboard home</div>} />
        </Routes>
        <Where />
      </RightSidebarProvider>
    </MemoryRouter>,
  );
}

const provider = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  provider: 'openai',
  auth_type: 'api_key',
  is_active: true,
  has_api_key: true,
  label: 'Default',
  priority: 0,
  connected_at: '',
  ...over,
});

const routedTier = {
  tier: 'default',
  override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-5.5' },
  fallback_routes: [{ provider: 'anthropic', authType: 'api_key', model: 'claude-a' }],
};

const created = { agent: { name: 'my-harness' }, apiKey: 'thk_full_key' };

/** Fills and submits the harness form, landing on the providers step. */
async function createHarnessFlow(name = 'My Harness') {
  fireEvent.change(await screen.findByLabelText('Harness name'), { target: { value: name } });
  fireEvent.click(createButton());
  await screen.findByRole('heading', { name: 'Connect providers' });
}

/** The form's submit button (the sidebar step shares its name). */
const createButton = (name = 'Create harness') =>
  screen
    .getAllByRole('button', { name })
    .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;

/** A button of the step content (the sidebar repeats the step names). */
const inMain = (name: string) => within(screen.getByRole('main')).getByRole('button', { name });

const stepButton = (label: string) => screen.getByRole('button', { name: new RegExp(label) });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockUserId = 'u1';
  selectProps = {};
  setupProps = {};
  providerModalProps = null;
  routingModalsProps = null;
  tierSectionProps = null;
  defaultTier = undefined;
  api.getPlaygroundAgent.mockResolvedValue({ name: 'playground-agent' });
  api.getProviders.mockResolvedValue([]);
  api.getCustomProviders.mockResolvedValue([]);
  api.getAgents.mockResolvedValue({ agents: [] });
  api.getAvailableModels.mockResolvedValue([]);
  api.getTierAssignments.mockResolvedValue([]);
  api.listModelParams.mockResolvedValue([]);
  api.refreshModels.mockResolvedValue({ ok: true });
  api.createAgent.mockResolvedValue(created);
  api.getAgentKey.mockResolvedValue({ apiKey: 'thk_restored', keyPrefix: 'thk_rest' });
  mockGetMessages.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Welcome: entry', () => {
  it('redirects a user who already finished onboarding to the dashboard', async () => {
    markOnboardingDone('u1');
    renderWelcome();
    await waitFor(() => expect(screen.getByText('dashboard home')).toBeTruthy());
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('shows the wizard for a user who has not finished onboarding', async () => {
    renderWelcome();
    expect(await screen.findByRole('heading', { name: 'Create your first harness' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/welcome');
  });

  it('does not redirect while the user id is unknown', async () => {
    mockUserId = undefined;
    markOnboardingDone('u1');
    renderWelcome();
    await screen.findByRole('heading', { name: 'Create your first harness' });
    expect(screen.getByTestId('where').textContent).toBe('/welcome');
  });

  it('sets the page title and description', async () => {
    renderWelcome();
    await screen.findByRole('heading', { name: 'Create your first harness' });
    expect(document.querySelector('title')!.textContent).toBe('Welcome - Thinker');
    expect(document.querySelector('meta[name="description"]')!.getAttribute('content')).toContain(
      'first reliable request',
    );
  });

  it('shows a restoring state until the existing harnesses were checked', async () => {
    api.getAgents.mockReturnValue(new Promise(() => {}));
    renderWelcome();
    expect(screen.getByText('Restoring your setup…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Create your first harness' })).toBeNull();
  });
});

describe('Welcome: sidebar', () => {
  it('lists the five steps, only the first reachable, with 0 of 5 done', async () => {
    renderWelcome();
    await screen.findByRole('heading', { name: 'Create your first harness' });
    const status = screen.getByRole('status', { name: '0 of 5 setup steps complete' });
    expect(status.textContent).toContain('0/5');
    const items = within(screen.getByRole('list')).getAllByRole('button');
    expect(items.map((b) => b.textContent!.replace(/^\d/, ''))).toEqual([
      'Create harness',
      'Connect providers',
      'Test models',
      'Configure routing',
      'Connect harness & go live',
    ]);
    expect((items[0] as HTMLButtonElement).disabled).toBe(false);
    expect(items[0].getAttribute('aria-current')).toBe('step');
    for (const locked of items.slice(1)) expect((locked as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks a step done and unlocks the next one after the harness is created', async () => {
    renderWelcome();
    await createHarnessFlow();
    expect(screen.getByRole('status', { name: '1 of 5 setup steps complete' })).toBeTruthy();
    const providersStep = stepButton('Connect providers') as HTMLButtonElement;
    expect(providersStep.getAttribute('aria-current')).toBe('step');
    expect((stepButton('Create harness') as HTMLButtonElement).disabled).toBe(false);
    expect((stepButton('Configure routing') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Skip setup" marks onboarding done and leaves for the dashboard', async () => {
    renderWelcome();
    fireEvent.click(await screen.findByRole('button', { name: 'Skip setup for now' }));
    await screen.findByText('dashboard home');
    expect(hasOnboardingBeenDone('u1')).toBe(true);
  });
});

describe('Welcome: harness step', () => {
  it('starts on the personal category with its first platform', async () => {
    renderWelcome();
    await screen.findByTestId('type-select');
    expect(selectProps.category).toBe('personal');
    expect(selectProps.platform).toBe('openclaw');
  });

  it('resets the platform to the first of the new category', async () => {
    renderWelcome();
    fireEvent.click(await screen.findByRole('button', { name: 'category coding' }));
    expect(screen.getByTestId('type-select').getAttribute('data-category')).toBe('coding');
    expect(screen.getByTestId('type-select').getAttribute('data-platform')).toBe('opencode');
  });

  it('cannot create without a name', async () => {
    renderWelcome();
    await screen.findByLabelText('Harness name');
    const create = createButton();
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Harness name'), { target: { value: '   ' } });
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Harness name'), { target: { value: 'Okay' } });
    expect(create.disabled).toBe(false);
  });

  it('creates the harness with the chosen type and logs on by default', async () => {
    renderWelcome();
    fireEvent.click(await screen.findByRole('button', { name: 'category coding' }));
    fireEvent.click(screen.getByRole('button', { name: 'platform codex' }));
    await createHarnessFlow('  Work Codex ');
    expect(api.createAgent).toHaveBeenCalledWith({
      name: 'Work Codex',
      agent_category: 'coding',
      agent_platform: 'codex',
      record_messages: true,
    });
  });

  it('sends record_messages=false when logs are switched off', async () => {
    renderWelcome();
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable logs' }));
    await createHarnessFlow();
    expect(api.createAgent.mock.calls[0][0].record_messages).toBe(false);
  });

  it('moves to the providers step and addresses the harness by name', async () => {
    renderWelcome();
    await createHarnessFlow('Edge Agent');
    expect(screen.getByText(/Edge Agent routes requests across the providers/)).toBeTruthy();
    expect(screen.getByText('Launch sequence · Step 2 of 5')).toBeTruthy();
    // Providers now load against the new harness, not the Playground agent.
    await waitFor(() => expect(api.getProviders).toHaveBeenCalledWith('my-harness'));
  });

  it('shows the backend error and keeps the form editable', async () => {
    api.createAgent.mockRejectedValue(new Error('Name already taken'));
    renderWelcome();
    fireEvent.change(await screen.findByLabelText('Harness name'), { target: { value: 'Dup' } });
    fireEvent.click(createButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Name already taken');
    expect(screen.getByLabelText('Harness name').getAttribute('aria-describedby')).toBe(
      'welcome-harness-error',
    );
    expect((screen.getByLabelText('Harness name') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('heading', { name: 'Create your first harness' })).toBeTruthy();
  });

  it('falls back to a generic error for a non-Error rejection', async () => {
    api.createAgent.mockRejectedValue('x');
    renderWelcome();
    fireEvent.change(await screen.findByLabelText('Harness name'), { target: { value: 'N' } });
    fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to create harness');
  });

  it('falls back to the typed name when the response carries no agent name', async () => {
    api.createAgent.mockResolvedValue({ apiKey: 'k' });
    renderWelcome();
    await createHarnessFlow('Typed Name');
    await waitFor(() => expect(api.getProviders).toHaveBeenCalledWith('Typed Name'));
  });

  it('after creation, going back shows the created harness instead of the form', async () => {
    renderWelcome();
    await createHarnessFlow('Edge Agent');
    fireEvent.click(stepButton('Create harness'));
    expect(await screen.findByText('Edge Agent')).toBeTruthy();
    expect(screen.queryByLabelText('Harness name')).toBeNull();
  });
});

describe('Welcome: providers step', () => {
  it('waits for the Playground agent before offering providers, then lists usage-based ones', async () => {
    renderWelcome();
    await createHarnessFlow();
    expect(await screen.findByRole('button', { name: /OpenAI/ })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Usage-based', 'Subscriptions', 'Local']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel')).toBeTruthy();
  });

  it('puts the popular providers before the long tail', async () => {
    renderWelcome();
    await createHarnessFlow();
    await screen.findByRole('button', { name: /OpenAI/ });
    const names = within(screen.getByRole('tabpanel'))
      .getAllByRole('button')
      .map((b) => b.textContent!);
    const at = (needle: string) => names.findIndex((n) => n.includes(needle));
    expect(at('OpenAI')).toBeGreaterThan(-1);
    expect(at('Cerebras')).toBeGreaterThan(-1);
    for (const popular of ['OpenAI', 'Anthropic', 'Groq', 'DeepSeek']) {
      expect(at(popular)).toBeLessThan(at('Cerebras'));
    }
  });

  it('switches tabs with a click and with the arrow keys, wrapping around', async () => {
    renderWelcome();
    await createHarnessFlow();
    await screen.findByRole('tabpanel');
    fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Usage-based' }).getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Local' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Usage-based' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Usage-based' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Local' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('aria-selected')).toBe('true');
  });

  it('local tab lists only local runtimes', async () => {
    renderWelcome();
    await createHarnessFlow();
    await screen.findByRole('tabpanel');
    fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
    const names = within(screen.getByRole('tabpanel'))
      .getAllByRole('button')
      .map((b) => b.textContent!);
    expect(names.some((n) => /Ollama/.test(n))).toBe(true);
    expect(names.some((n) => /^OpenAI/.test(n))).toBe(false);
  });

  it('opens the connect modal for a provider with the right deep link, and closes it', async () => {
    renderWelcome();
    await createHarnessFlow();
    fireEvent.click(await screen.findByRole('button', { name: /OpenAI/ }));
    expect(screen.getByRole('dialog', { name: 'connect modal' })).toBeTruthy();
    expect(providerModalProps!.agentName).toBe('my-harness');
    expect(providerModalProps!.providerDeepLink).toEqual({
      providerId: 'openai',
      authType: 'api_key',
    });
    fireEvent.click(screen.getByRole('button', { name: 'modal close' }));
    expect(screen.queryByRole('dialog', { name: 'connect modal' })).toBeNull();
  });

  it('a local provider connects as an api_key connection', async () => {
    renderWelcome();
    await createHarnessFlow();
    await screen.findByRole('tabpanel');
    fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
    fireEvent.click(within(screen.getByRole('tabpanel')).getAllByRole('button')[0]);
    expect(providerModalProps!.providerDeepLink.authType).toBe('api_key');
  });

  it('with nothing connected, shows the hint and blocks Test models', async () => {
    renderWelcome();
    await createHarnessFlow();
    expect(await screen.findByText('Connect at least one provider to continue.')).toBeTruthy();
    expect((inMain('Test models') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Test models later' })).toBeNull();
  });

  it('badges connected providers and enables the next steps', async () => {
    api.getProviders.mockResolvedValue([provider()]);
    renderWelcome();
    await createHarnessFlow();
    const openai = await screen.findByRole('button', { name: /OpenAI/ });
    await waitFor(() => expect(within(openai).getByText('Connected')).toBeTruthy());
    expect(screen.getByText('1 provider connected.')).toBeTruthy();
    expect((inMain('Test models') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status', { name: '2 of 5 setup steps complete' })).toBeTruthy();
  });

  it('does not count an inactive or key-less connection', async () => {
    api.getProviders.mockResolvedValue([
      provider({ is_active: false }),
      provider({ id: 'p2', provider: 'anthropic', has_api_key: false }),
    ]);
    renderWelcome();
    await createHarnessFlow();
    await screen.findByRole('button', { name: /OpenAI/ });
    expect(screen.getByText('Connect at least one provider to continue.')).toBeTruthy();
  });

  it('counts a connected custom provider, pluralizing the label', async () => {
    api.getProviders.mockResolvedValue([provider()]);
    api.getCustomProviders.mockResolvedValue([{ id: 'c1' }]);
    renderWelcome();
    await createHarnessFlow();
    expect(await screen.findByText('2 providers connected.')).toBeTruthy();
  });

  it('shows a load error when the providers cannot be fetched', async () => {
    api.getProviders.mockRejectedValue(new Error('nope'));
    renderWelcome();
    await createHarnessFlow();
    expect((await screen.findByText(/could not load your providers/)).getAttribute('role')).toBe(
      'alert',
    );
  });

  it('refreshes models and reloads providers after a connection, against the new harness', async () => {
    api.getProviders.mockResolvedValue([provider()]);
    renderWelcome();
    await createHarnessFlow();
    fireEvent.click(await screen.findByRole('button', { name: /OpenAI/ }));
    api.refreshModels.mockClear();
    const before = api.getProviders.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'modal update' }));
    await waitFor(() => expect(api.refreshModels).toHaveBeenCalledWith('my-harness'));
    expect(api.getProviders.mock.calls.length).toBeGreaterThan(before);
  });

  it('survives a failed model refresh after connecting', async () => {
    api.getProviders.mockResolvedValue([provider()]);
    api.refreshModels.mockRejectedValue(new Error('discovery failed'));
    renderWelcome();
    await createHarnessFlow();
    fireEvent.click(await screen.findByRole('button', { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'modal update' }));
    await waitFor(() => expect(api.refreshModels).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'connect modal' })).toBeTruthy();
  });
});

describe('Welcome: playground and routing steps', () => {
  async function toProvidersConnected() {
    api.getProviders.mockResolvedValue([provider()]);
    renderWelcome();
    await createHarnessFlow();
    await waitFor(() => expect((inMain('Test models') as HTMLButtonElement).disabled).toBe(false));
  }

  it('opens the optional playground step and can go back', async () => {
    await toProvidersConnected();
    fireEvent.click(inMain('Test models'));
    expect(await screen.findByTestId('playground')).toBeTruthy();
    expect(screen.getByText('This step is optional.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to providers' }));
    expect(await screen.findByRole('heading', { name: 'Connect providers' })).toBeTruthy();
  });

  it('refreshes discovery when entering a step with no models yet', async () => {
    await toProvidersConnected();
    api.refreshModels.mockClear();
    fireEvent.click(inMain('Test models'));
    await waitFor(() => expect(api.refreshModels).toHaveBeenCalledWith('my-harness'));
  });

  it('skip-ahead link goes straight to routing', async () => {
    await toProvidersConnected();
    fireEvent.click(screen.getByRole('button', { name: 'Test models later' }));
    expect(await screen.findByRole('heading', { name: 'Configure default routing' })).toBeTruthy();
  });

  it('renders the real default routing card for the harness and blocks Continue until routed', async () => {
    await toProvidersConnected();
    fireEvent.click(screen.getByRole('button', { name: 'Test models later' }));
    await screen.findByTestId('tier-section');
    expect(tierSectionProps!.agentName).toBe('my-harness');
    expect(tierSectionProps!.embedded).toBe(true);
    expect(tierSectionProps!.showComplexityToggle).toBe(false);
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to test models' }));
    expect(await screen.findByTestId('playground')).toBeTruthy();
  });

  it('enables Continue once the default route has a provider, then goes live', async () => {
    defaultTier = routedTier;
    await toProvidersConnected();
    fireEvent.click(screen.getByRole('button', { name: 'Test models later' }));
    await screen.findByTestId('tier-section');
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(
      await screen.findByRole('heading', { name: 'Connect your harness and go live' }),
    ).toBeTruthy();
  });

  it('the auto-assigned route also counts as routed', async () => {
    defaultTier = {
      tier: 'default',
      override_route: null,
      auto_assigned_route: { provider: 'OpenAI', authType: 'api_key', model: 'm' },
      fallback_routes: null,
    };
    await toProvidersConnected();
    fireEvent.click(screen.getByRole('button', { name: 'Test models later' }));
    await screen.findByTestId('tier-section');
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('reveals the routing modals and returns to providers from "add provider"', async () => {
    await toProvidersConnected();
    expect(routingModalsProps!.agentName).toBe('my-harness');
    act(() => routingModalsProps!.onOpenProviderModal());
    expect(await screen.findByRole('heading', { name: 'Connect providers' })).toBeTruthy();
  });
});

describe('Welcome: activation step', () => {
  async function toActivate(fakeTimers = false) {
    defaultTier = routedTier;
    api.getProviders.mockResolvedValue([provider()]);
    renderWelcome();
    await createHarnessFlow();
    await waitFor(() => expect((inMain('Test models') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Test models later' }));
    await screen.findByTestId('tier-section');
    if (fakeTimers) {
      // Only the last step runs under fake time, so waitFor keeps working before it.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    if (fakeTimers) {
      await act(async () => {});
      screen.getByRole('heading', { name: 'Connect your harness and go live' });
      return;
    }
    await screen.findByRole('heading', { name: 'Connect your harness and go live' });
  }

  it('gives the harness setup instructions with the real key and base URL', async () => {
    await toActivate();
    expect(screen.getByTestId('setup-instructions')).toBeTruthy();
    expect(setupProps.apiKey).toBe('thk_full_key');
    expect(setupProps.baseUrl).toBe(window.location.origin + '/v1');
    expect(setupProps.platform).toBe('openclaw');
    expect(screen.getByText(/Point My Harness at Thinker/)).toBeTruthy();
  });

  it('checks for a request straight away and shows the waiting state', async () => {
    await toActivate();
    await waitFor(() =>
      expect(mockGetMessages).toHaveBeenCalledWith(
        { agent_name: 'my-harness', limit: '1', include_total: 'false' },
        { cache: false },
      ),
    );
    expect(screen.getByText('Waiting for your agent’s first request')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go to dashboard' })).toBeNull();
    expect(hasOnboardingBeenDone('u1')).toBe(false);
  });

  it('detects the first successful request, marks onboarding done and offers the dashboard', async () => {
    mockGetMessages.mockResolvedValue({
      items: [{ status: 'success', model: 'gpt-5.5', duration_ms: 420 }],
    });
    await toActivate();
    expect(await screen.findByText('Your harness is live.')).toBeTruthy();
    expect(
      screen.getByText(/Thinker successfully routed the first real request/).textContent,
    ).toContain('to gpt-5.5 in 420 ms.');
    expect(hasOnboardingBeenDone('u1')).toBe(true);
    expect(screen.getByRole('status', { name: '5 of 5 setup steps complete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Go to dashboard/ }));
    await screen.findByText('dashboard home');
  });

  it('shows the failure of a request that reached Thinker but failed, with a docs link for its M-code', async () => {
    mockGetMessages.mockResolvedValue({
      items: [{ status: 'error', error_message: 'No provider key (M300)' }],
    });
    await toActivate();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We received the request, but it failed.');
    expect(alert.textContent).toContain('No provider key (M300)');
    const link = within(alert).getByRole('link', { name: 'What does M300 mean?' });
    expect(link.getAttribute('href')).toMatch(/#m300$/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(hasOnboardingBeenDone('u1')).toBe(false);
    expect(screen.queryByRole('button', { name: /Go to dashboard/ })).toBeNull();
  });

  it('describes a failure that has no message by its status, and no docs link', async () => {
    mockGetMessages.mockResolvedValue({ items: [{ status: 'rate_limited' }] });
    await toActivate();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Thinker recorded status “rate_limited”');
    expect(within(alert).queryByRole('link')).toBeNull();
  });

  it('reports a check failure and keeps trying; "Check again" re-polls on demand', async () => {
    mockGetMessages.mockRejectedValueOnce(new Error('offline'));
    await toActivate();
    expect(await screen.findByText(/We couldn’t verify a request just now/)).toBeTruthy();
    mockGetMessages.mockResolvedValue({ items: [{ status: 'success' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Your harness is live.')).toBeTruthy();
  });

  it('polls every 4 seconds and nudges after a minute of silence', async () => {
    await toActivate(true);
    expect(mockGetMessages).toHaveBeenCalledTimes(1); // the immediate check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(mockGetMessages).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(mockGetMessages).toHaveBeenCalledTimes(4);
    expect(screen.queryByText(/Most agents need a restart/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText(/Most agents need a restart/)).toBeTruthy();
  });

  it('does not nudge about a restart when a failed request already explains the silence', async () => {
    mockGetMessages.mockResolvedValue({ items: [{ status: 'error', error_message: 'boom' }] });
    await toActivate(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(screen.queryByText(/Most agents need a restart/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('stops polling once a successful request was seen', async () => {
    mockGetMessages.mockResolvedValue({ items: [{ status: 'ok' }] });
    await toActivate(true);
    expect(screen.getByText('Your harness is live.')).toBeTruthy();
    mockGetMessages.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  it('can go back to routing', async () => {
    await toActivate();
    fireEvent.click(screen.getByRole('button', { name: 'Back to routing' }));
    expect(await screen.findByRole('heading', { name: 'Configure default routing' })).toBeTruthy();
  });
});

describe('Welcome: resuming an unfinished setup', () => {
  const candidate = {
    agent_name: 'old-harness',
    display_name: 'Old Harness',
    agent_category: 'coding',
    agent_platform: 'claude-code',
    message_count: 0,
  };

  it('ignores harnesses that already served traffic', async () => {
    api.getAgents.mockResolvedValue({ agents: [{ ...candidate, message_count: 12 }] });
    renderWelcome();
    expect(await screen.findByRole('heading', { name: 'Create your first harness' })).toBeTruthy();
    expect(api.getAgentKey).not.toHaveBeenCalled();
  });

  it('resumes the newest zero-message harness at the providers step when nothing is connected', async () => {
    api.getAgents.mockResolvedValue({ agents: [candidate] });
    renderWelcome();
    expect(await screen.findByRole('heading', { name: 'Connect providers' })).toBeTruthy();
    expect(screen.getByText(/Old Harness routes requests/)).toBeTruthy();
    await waitFor(() => expect(api.getProviders).toHaveBeenCalledWith('old-harness'));
    expect(api.createAgent).not.toHaveBeenCalled();
  });

  it('jumps to the playground when providers are connected but nothing is routed', async () => {
    api.getAgents.mockResolvedValue({ agents: [candidate] });
    api.getProviders.mockResolvedValue([provider()]);
    renderWelcome();
    expect(await screen.findByTestId('playground')).toBeTruthy();
  });

  it('jumps to activation when routing is already configured, using the restored key', async () => {
    defaultTier = routedTier;
    api.getAgents.mockResolvedValue({ agents: [candidate] });
    api.getProviders.mockResolvedValue([provider()]);
    api.getTierAssignments.mockResolvedValue([routedTier]);
    renderWelcome();
    expect(
      await screen.findByRole('heading', { name: 'Connect your harness and go live' }),
    ).toBeTruthy();
    await waitFor(() => expect(setupProps.apiKey).toBe('thk_restored'));
    expect(setupProps.keyPrefix).toBe('thk_rest');
    expect(setupProps.platform).toBe('claude-code');
  });

  it('keeps going when the key cannot be restored', async () => {
    api.getAgentKey.mockRejectedValue(new Error('forbidden'));
    api.getAgents.mockResolvedValue({ agents: [candidate] });
    renderWelcome();
    expect(await screen.findByRole('heading', { name: 'Connect providers' })).toBeTruthy();
  });

  it('prefers the slug as the name when the harness has no display name', async () => {
    api.getAgents.mockResolvedValue({ agents: [{ ...candidate, display_name: null }] });
    renderWelcome();
    expect(await screen.findByText(/old-harness routes requests/)).toBeTruthy();
  });

  it('starts the wizard normally when the harness list fails to load', async () => {
    api.getAgents.mockRejectedValue(new Error('down'));
    renderWelcome();
    expect(await screen.findByRole('heading', { name: 'Create your first harness' })).toBeTruthy();
  });
});

describe('Welcome: dev liftoff preview', () => {
  it('shows the liftoff cinematic with ?preview=liftoff and leaves from it', async () => {
    renderWelcome('/welcome?preview=liftoff');
    expect(await screen.findByRole('dialog', { name: 'liftoff' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'liftoff leave' }));
    await screen.findByText('dashboard home');
    expect(hasOnboardingBeenDone('u1')).toBe(true);
  });

  it('does not show it otherwise', async () => {
    renderWelcome();
    await screen.findByRole('heading', { name: 'Create your first harness' });
    expect(screen.queryByRole('dialog', { name: 'liftoff' })).toBeNull();
  });
});

describe('Welcome in pt-BR', () => {
  beforeEach(() => resetLocaleForTests('pt-BR'));

  it('translates the harness step, sidebar and skip button', async () => {
    renderWelcome();
    expect(await screen.findByRole('heading', { name: 'Crie seu primeiro harness' })).toBeTruthy();
    expect(screen.getByLabelText('Nome do harness')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pular a configuração por enquanto' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: '0 de 5 etapas da configuração concluídas' }),
    ).toBeTruthy();
    expect(screen.getByText('Sequência de lançamento · Etapa 1 de 5')).toBeTruthy();
    expect(screen.queryByText('Create harness')).toBeNull();
  });

  it('translates the providers step and pluralizes the connected count', async () => {
    api.getProviders.mockResolvedValue([provider()]);
    renderWelcome();
    fireEvent.change(await screen.findByLabelText('Nome do harness'), { target: { value: 'Meu' } });
    fireEvent.click(createButton('Criar harness'));
    expect(await screen.findByRole('heading', { name: 'Conectar provedores' })).toBeTruthy();
    expect(await screen.findByText('1 provedor conectado.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Por uso' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Assinaturas' })).toBeTruthy();
  });
});
