import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: (id: string) => <span data-testid={'provider-icon-' + id} />,
  customProviderLogo: (name: string) =>
    name === 'Logo Co' ? <b data-testid="custom-logo" /> : null,
}));
vi.mock('../../src/components/AuthBadge.js', () => ({
  authBadgeFor: (auth: string | null) => (auth ? <i data-testid={'auth-' + auth} /> : null),
}));

let managerProps: Record<string, any> | null = null;
vi.mock('../../src/components/ModelChainManager.js', () => ({
  default: (props: Record<string, unknown>) => {
    managerProps = props;
    return <div role="dialog" aria-label="model manager" />;
  },
}));

const paramsProps: Record<string, any>[] = [];
vi.mock('../../src/components/ModelParamsAffordance.jsx', () => ({
  default: (props: Record<string, unknown>) => {
    paramsProps.push(props);
    return <span data-testid="params-affordance" />;
  },
}));

import RouteChainCard, {
  type RouteChain,
  type RouteChainCardProps,
} from '../../src/components/RouteChainCard';
import type { AvailableModel, ModelRoute, RoutingProvider } from '../../src/services/api';
import { resetLocaleForTests } from '../../src/i18n';

const model = (over: Partial<AvailableModel> = {}): AvailableModel => ({
  model_name: 'gpt-5.5',
  provider: 'OpenAI',
  input_price_per_token: 0.000002,
  output_price_per_token: 0.00001,
  context_window: 128000,
  capability_reasoning: false,
  capability_code: false,
  quality_score: 3,
  display_name: 'GPT 5.5',
  ...over,
});

const key = (over: Partial<RoutingProvider> = {}): RoutingProvider => ({
  id: 'k1',
  provider: 'openai',
  auth_type: 'api_key',
  is_active: true,
  has_api_key: true,
  label: 'Default',
  priority: 0,
  connected_at: '',
  ...over,
});

const chain = (over: Partial<RouteChain> = {}): RouteChain => ({
  id: 'tier-1',
  name: 'My chain',
  override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-5.5' },
  fallback_routes: [
    { provider: 'anthropic', authType: 'api_key', model: 'claude-a' },
    { provider: 'google', authType: 'api_key', model: 'gemini-b' },
  ],
  ...over,
});

function setup(over: Partial<RouteChainCardProps> = {}) {
  const props: RouteChainCardProps = {
    agentName: 'demo',
    chain: chain(),
    cardClass: 'routing-card--test',
    models: [model()],
    customProviders: [],
    connectedProviders: [key()],
    onOverride: vi.fn(),
    onFallbacksUpdate: vi.fn(),
    persistFallbacks: vi.fn().mockResolvedValue(undefined),
    persistClearFallbacks: vi.fn().mockResolvedValue(undefined),
    paramsScope: 'header:tier-1',
    renderMenu: (close) => <button onClick={close}>menu-item</button>,
    ...over,
  };
  const utils = render(<RouteChainCard {...props} />);
  return { ...utils, props };
}

const routeNames = (container: HTMLElement) =>
  [...container.querySelectorAll('.routing-card__main')].map((el) => el.textContent);

const openManager = () => fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

beforeEach(() => {
  vi.clearAllMocks();
  managerProps = null;
  paramsProps.length = 0;
});

afterEach(() => resetLocaleForTests('en'));

describe('RouteChainCard flow', () => {
  it('lists the primary and the fallbacks top to bottom', () => {
    const { container } = setup();
    expect(routeNames(container)).toEqual(['GPT 5.5', 'claude-a', 'gemini-b']);
    expect(screen.getByTestId('provider-icon-openai')).toBeTruthy();
    expect(screen.getByTestId('provider-icon-anthropic')).toBeTruthy();
    expect(screen.getAllByTestId('auth-api_key')).toHaveLength(3);
  });

  it('shows the chain name and applies cardClass and enabled classList entries only', () => {
    const { container } = setup({ classList: { 'is-on': true, 'is-off': false } });
    expect(screen.getByText('My chain')).toBeTruthy();
    const root = container.firstElementChild!;
    expect(root.className).toContain('routing-card--test');
    expect(root.className).toContain('is-on');
    expect(root.className).not.toContain('is-off');
  });

  it('falls back to the raw model id, and resolves a dated catalog entry by prefix', () => {
    const { container, unmount } = setup({ models: [] });
    expect(routeNames(container)[0]).toBe('gpt-5.5');
    unmount();
    const dated = setup({
      models: [model({ model_name: 'gpt-5.5-2026-01-01', display_name: 'GPT dated' })],
    });
    expect(routeNames(dated.container)[0]).toBe('GPT dated');
  });

  it('shows the per-million price, the subscription price per request or "included"', () => {
    const { container, unmount } = setup({ chain: chain({ fallback_routes: null }) });
    expect(container.querySelector('.routing-card__chip-price')!.textContent).toBe(
      '$2.00 in, $10.00 out',
    );
    unmount();
    const sub = chain({
      override_route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.5' },
      fallback_routes: null,
    });
    const perRequest = setup({ chain: sub, models: [model({ cost_per_request: 0.04 })] });
    expect(perRequest.container.querySelector('.routing-card__chip-price')!.textContent).toContain(
      '0.04',
    );
    perRequest.unmount();
    const included = setup({ chain: sub, models: [model({ cost_per_request: null })] });
    expect(included.container.querySelector('.routing-card__chip-price')!.textContent).toBe(
      'Subscription',
    );
  });

  it('names the account of each route: its pin, the only key, or any by priority', () => {
    const { container } = setup({
      chain: chain({
        override_route: {
          provider: 'openai',
          authType: 'api_key',
          model: 'gpt-5.5',
          keyLabel: 'Work',
        },
        fallback_routes: [
          { provider: 'openai', authType: 'api_key', model: 'gpt-x' },
          { provider: 'anthropic', authType: 'api_key', model: 'claude-a' },
        ],
      }),
      connectedProviders: [
        key({ id: 'a', label: 'Personal' }),
        key({ id: 'b', label: 'Work', priority: 1 }),
        key({ id: 'c', provider: 'anthropic', label: 'Solo' }),
      ],
    });
    const accounts = [...container.querySelectorAll('.routing-card__account')].map(
      (el) => el.textContent,
    );
    expect(accounts).toEqual(['Work', 'any account (by priority)', 'Solo']);
  });

  it('renders nothing below the header for an empty chain', () => {
    const { container } = setup({ chain: chain({ override_route: null, fallback_routes: null }) });
    expect(container.querySelector('.routing-card__route')).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  });

  it('badges and dims a route that cannot stream while the chain is in stream mode', () => {
    const { container } = setup({
      chain: chain({ response_mode: 'stream', fallback_routes: null }),
      models: [model({ capabilities: ['tools'] })],
    });
    expect(screen.getByText('Skipped in Stream')).toBeTruthy();
    expect(container.querySelector('.routing-card__route--skipped')).toBeTruthy();
  });

  it('shows no stream badge when the route streams, or in buffered mode', () => {
    setup({
      chain: chain({ response_mode: 'stream', fallback_routes: null }),
      models: [model({ capabilities: ['stream'] })],
    });
    expect(screen.queryByText('Skipped in Stream')).toBeNull();
  });

  it('offers no in-card editing: no change, remove or key controls', () => {
    setup();
    const buttons = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(buttons).toEqual(['Options for My chain', 'Manage']);
  });

  it('keeps the params out of the card and hands them to the manager', () => {
    const getModelParams = vi.fn(() => null);
    const setModelParams = vi.fn();
    setup({ getModelParams, setModelParams });
    expect(screen.queryByTestId('params-affordance')).toBeNull();
    openManager();
    expect(managerProps!.paramsScope).toBe('header:tier-1');
    expect(managerProps!.getModelParams).toBe(getModelParams);
    expect(managerProps!.setModelParams).toBe(setModelParams);
  });

  it('hides the options menu when the wrapper gives none, and toggles it otherwise', () => {
    const { unmount } = setup({ renderMenu: undefined });
    expect(screen.queryByRole('button', { name: 'Options for My chain' })).toBeNull();
    unmount();
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Options for My chain' }));
    fireEvent.click(screen.getByText('menu-item'));
    expect(screen.queryByText('menu-item')).toBeNull();
  });
});

describe('RouteChainCard manager', () => {
  it('opens the manager with the chain in order and the stream requirement', () => {
    setup({ chain: chain({ response_mode: 'stream' }) });
    openManager();
    expect(screen.getByRole('dialog', { name: 'model manager' })).toBeTruthy();
    expect(managerProps!.chainId).toBe('tier-1');
    expect(managerProps!.routes.map((r: ModelRoute) => r.model)).toEqual([
      'gpt-5.5',
      'claude-a',
      'gemini-b',
    ]);
    expect(managerProps!.requiredCapability).toBe('stream');
    act(() => managerProps!.onClose());
    expect(screen.queryByRole('dialog', { name: 'model manager' })).toBeNull();
  });

  it('saves a chain as the primary, then the fallbacks', async () => {
    const { props } = setup();
    openManager();
    const next: ModelRoute[] = [
      { provider: 'anthropic', authType: 'api_key', model: 'claude-a', keyLabel: 'Work' },
      { provider: 'openai', authType: 'api_key', model: 'gpt-5.5' },
    ];
    await act(() => managerProps!.onSave(next));
    expect(props.onOverride).toHaveBeenCalledWith('claude-a', 'anthropic', 'api_key', 'Work');
    expect(props.persistFallbacks).toHaveBeenCalledWith(['gpt-5.5'], [next[1]]);
    expect(props.onFallbacksUpdate).toHaveBeenCalledWith(['gpt-5.5'], [next[1]]);
  });

  it('clears the fallbacks when the chain keeps only a primary', async () => {
    const { props } = setup();
    openManager();
    await act(() =>
      managerProps!.onSave([{ provider: 'openai', authType: 'api_key', model: 'gpt-5.5' }]),
    );
    expect(props.persistClearFallbacks).toHaveBeenCalled();
    expect(props.persistFallbacks).not.toHaveBeenCalled();
    expect(props.onFallbacksUpdate).toHaveBeenCalledWith([], []);
  });

  it('clears the whole chain when emptied, and refuses without a clear handler', async () => {
    const persistClearChain = vi.fn().mockResolvedValue(undefined);
    const { props, unmount } = setup({ persistClearChain });
    openManager();
    await act(() => managerProps!.onSave([]));
    expect(persistClearChain).toHaveBeenCalled();
    expect(props.onOverride).not.toHaveBeenCalled();
    unmount();
    setup();
    openManager();
    await expect(managerProps!.onSave([])).rejects.toThrow();
  });

  it('fails the save, without touching the fallbacks, when the primary is rejected', async () => {
    const { props } = setup({ onOverride: vi.fn().mockRejectedValue(new Error('no')) });
    openManager();
    await expect(
      managerProps!.onSave([
        { provider: 'openai', authType: 'api_key', model: 'gpt-5.5' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-a' },
      ]),
    ).rejects.toThrow('no');
    expect(props.persistFallbacks).not.toHaveBeenCalled();
  });
});

describe('RouteChainCard in pt-BR', () => {
  it('translates the manage button', () => {
    resetLocaleForTests('pt-BR');
    setup();
    expect(screen.getByRole('button', { name: 'Gerenciar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
  });
});
