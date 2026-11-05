import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store', () => ({ toast: mockToast }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: mockToast }));

vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: (id: string) => <span data-testid={'provider-icon-' + id} />,
  customProviderLogo: (name: string) =>
    name === 'Logo Co' ? <b data-testid="custom-logo" /> : null,
}));
vi.mock('../../src/components/AuthBadge.js', () => ({
  authBadgeFor: (auth: string | null) => (auth ? <i data-testid={'auth-' + auth} /> : null),
}));

let fallbackProps: Record<string, any> = {};
vi.mock('../../src/components/FallbackList.js', () => ({
  default: (props: Record<string, unknown>) => {
    fallbackProps = props;
    return <div data-testid="fallback-list" />;
  },
}));

let pickerProps: Record<string, any> | null = null;
vi.mock('../../src/components/ModelPickerModal.js', () => ({
  default: (props: Record<string, unknown>) => {
    pickerProps = props;
    return <div role="dialog" aria-label="model picker" />;
  },
}));

let keyModalProps: Record<string, any> | null = null;
vi.mock('../../src/components/KeyPickerModal.js', () => ({
  default: (props: Record<string, unknown>) => {
    keyModalProps = props;
    return <div role="dialog" aria-label="key picker" />;
  },
}));

let keyChipProps: Record<string, any> | null = null;
vi.mock('../../src/components/RouteKeyChip.js', () => ({
  default: (props: Record<string, unknown>) => {
    keyChipProps = props;
    return <span data-testid="key-chip" />;
  },
}));

let paramsProps: Record<string, any> | null = null;
vi.mock('../../src/components/ModelParamsAffordance.jsx', () => ({
  default: (props: Record<string, unknown>) => {
    paramsProps = props;
    return <span data-testid="params-affordance" />;
  },
}));

import RouteChainCard, {
  type RouteChain,
  type RouteChainCardProps,
} from '../../src/components/RouteChainCard';
import type { AvailableModel, RoutingProvider } from '../../src/services/api';
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

beforeEach(() => {
  vi.clearAllMocks();
  fallbackProps = {};
  pickerProps = null;
  keyModalProps = null;
  keyChipProps = null;
  paramsProps = null;
});

describe('RouteChainCard primary chip', () => {
  it('shows the model display name, provider icon, auth badge and per-million price', () => {
    const { container } = setup();
    expect(container.querySelector('.routing-card__main')!.textContent).toBe('GPT 5.5');
    expect(screen.getByTestId('provider-icon-openai')).toBeTruthy();
    expect(screen.getByTestId('auth-api_key')).toBeTruthy();
    expect(container.querySelector('.routing-card__chip-price')!.textContent).toBe(
      '$2.00 in · $10.00 out per 1M',
    );
  });

  it('shows the chain name and applies cardClass and enabled classList entries only', () => {
    const { container } = setup({ classList: { 'is-on': true, 'is-off': false } });
    expect(screen.getByText('My chain')).toBeTruthy();
    const root = container.firstElementChild!;
    expect(root.className).toContain('routing-card--test');
    expect(root.className).toContain('is-on');
    expect(root.className).not.toContain('is-off');
  });

  it('falls back to the raw model id when the catalog does not list it', () => {
    const { container } = setup({ models: [] });
    expect(container.querySelector('.routing-card__main')!.textContent).toBe('gpt-5.5');
    expect(container.querySelector('.routing-card__chip-price')!.textContent).toBe('');
  });

  it('resolves a dated catalog entry by prefix', () => {
    const { container } = setup({
      models: [model({ model_name: 'gpt-5.5-2026-01-01', display_name: 'GPT dated' })],
    });
    expect(container.querySelector('.routing-card__main')!.textContent).toBe('GPT dated');
  });

  it('shows the subscription price per request, or "included" when there is none', () => {
    const sub = chain({
      override_route: { provider: 'openai', authType: 'subscription', model: 'gpt-5.5' },
    });
    const { container, unmount } = setup({
      chain: sub,
      models: [model({ cost_per_request: 0.04 })],
    });
    expect(container.querySelector('.routing-card__chip-price')!.textContent).toContain('0.04');
    unmount();
    const second = setup({ chain: sub, models: [model({ cost_per_request: null })] });
    expect(second.container.querySelector('.routing-card__chip-price')!.textContent).toBe(
      'Included in subscription',
    );
  });

  it('infers the auth type from connected providers: subscription beats api_key beats local', () => {
    const noAuth = chain({ override_route: { provider: 'openai', model: 'gpt-5.5' } as never });
    const providers = [
      key({ id: 'a', auth_type: 'local' }),
      key({ id: 'b', auth_type: 'api_key' }),
      key({ id: 'c', auth_type: 'subscription' }),
    ];
    const { unmount } = setup({ chain: noAuth, connectedProviders: providers });
    expect(screen.getByTestId('auth-subscription')).toBeTruthy();
    unmount();
    const b = setup({ chain: noAuth, connectedProviders: providers.slice(0, 2) });
    expect(b.container.querySelector('[data-testid="auth-api_key"]')).not.toBeNull();
    b.unmount();
    const c = setup({ chain: noAuth, connectedProviders: providers.slice(0, 1) });
    expect(c.container.querySelector('[data-testid="auth-local"]')).not.toBeNull();
  });

  it('renders a custom provider as a coloured initial, or its logo', () => {
    const custom = chain({
      override_route: { provider: 'custom:cp1', authType: 'api_key', model: 'm' },
    });
    const { container, unmount } = setup({
      chain: custom,
      models: [],
      customProviders: [{ id: 'cp1', name: 'acme' } as never],
    });
    expect(container.querySelector('.routing-card__override-icon')!.textContent).toBe('A');
    unmount();
    const logo = setup({
      chain: custom,
      models: [],
      customProviders: [{ id: 'cp1', name: 'Logo Co' } as never],
    });
    expect(logo.getByTestId('custom-logo')).toBeTruthy();
  });

  it('uses "C" when a custom provider is no longer listed', () => {
    const { container } = setup({
      chain: chain({
        override_route: { provider: 'custom:gone', authType: 'api_key', model: 'm' },
      }),
      models: [],
    });
    expect(container.querySelector('.routing-card__override-icon')!.textContent).toBe('C');
  });
});

describe('RouteChainCard empty chain', () => {
  it('offers only "+ Add model" and no chip or fallback list', () => {
    const { container } = setup({ chain: chain({ override_route: null, fallback_routes: null }) });
    expect(container.querySelector('.routing-card__model-chip')).toBeNull();
    expect(screen.queryByTestId('fallback-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add model' }));
    expect(screen.getByRole('dialog', { name: 'model picker' })).toBeTruthy();
    expect(pickerProps!.tierId).toBe('tier-1');
    expect(pickerProps!.requiredCapability).toBeUndefined();
  });

  it('hides "+ Add model" once a primary exists', () => {
    setup();
    expect(screen.queryByRole('button', { name: '+ Add model' })).toBeNull();
  });
});

describe('RouteChainCard stream mode', () => {
  const streamChain = chain({ response_mode: 'stream' });

  it('badges and dims a primary that cannot stream, and the picker requires the capability', () => {
    const { container } = setup({ chain: streamChain, models: [model({ capabilities: [] })] });
    expect(container.querySelector('.routing-card__skipped-badge')!.textContent).toBe(
      'Skipped in Stream',
    );
    expect(container.querySelector('.routing-card__model-chip--skipped')).not.toBeNull();
    fireEvent.click(container.querySelector('.routing-card__model-chip')!);
    expect(pickerProps!.requiredCapability).toBe('stream');
  });

  it('shows no badge when the primary supports stream', () => {
    const { container } = setup({
      chain: streamChain,
      models: [model({ capabilities: ['stream'] as never })],
    });
    expect(container.querySelector('.routing-card__skipped-badge')).toBeNull();
  });

  it('never badges in buffered mode', () => {
    const { container } = setup({ chain: chain({ response_mode: 'buffered' }) });
    expect(container.querySelector('.routing-card__skipped-badge')).toBeNull();
  });
});

describe('RouteChainCard fallbacks', () => {
  it('hands FallbackList the fallback models in chain order', () => {
    setup();
    expect(fallbackProps.fallbacks).toEqual(['claude-a', 'gemini-b']);
    expect(fallbackProps.tier).toBe('tier-1');
    expect(fallbackProps.modelParamsScope).toBe('header:tier-1');
    expect(fallbackProps.responseMode).toBe('buffered');
  });

  it('treats null fallback routes as an empty list', () => {
    setup({ chain: chain({ fallback_routes: null }) });
    expect(fallbackProps.fallbacks).toEqual([]);
    expect(fallbackProps.fallbackRoutes).toBeNull();
  });

  it('forwards updates and persistence of the list unchanged', async () => {
    const { props } = setup();
    fallbackProps.onUpdate(['x'], [{ provider: 'p', authType: 'api_key', model: 'x' }]);
    expect(props.onFallbacksUpdate).toHaveBeenCalledWith(
      ['x'],
      [{ provider: 'p', authType: 'api_key', model: 'x' }],
    );
    await fallbackProps.persistFallbacks('agent', 'id', ['x'], []);
    expect(props.persistFallbacks).toHaveBeenCalledWith(['x'], []);
    await fallbackProps.persistClearFallbacks();
    expect(props.persistClearFallbacks).toHaveBeenCalled();
  });

  it('appends a picked fallback to the end of the chain and persists the ordered routes', async () => {
    const { props } = setup();
    act(() => fallbackProps.onAddFallback());
    expect(pickerProps).not.toBeNull();
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-mini', 'openai', 'api_key');
    });
    const expectedRoutes = [
      { provider: 'anthropic', authType: 'api_key', model: 'claude-a' },
      { provider: 'google', authType: 'api_key', model: 'gemini-b' },
      { provider: 'openai', authType: 'api_key', model: 'gpt-mini' },
    ];
    expect(props.persistFallbacks).toHaveBeenCalledWith(
      ['claude-a', 'gemini-b', 'gpt-mini'],
      expectedRoutes,
    );
    expect(props.onFallbacksUpdate).toHaveBeenCalledWith(
      ['claude-a', 'gemini-b', 'gpt-mini'],
      expectedRoutes,
    );
    expect(mockToast.success).toHaveBeenCalledWith('Fallback added');
    expect(screen.queryByRole('dialog', { name: 'model picker' })).toBeNull();
  });

  it('defaults the new fallback auth type to api_key', async () => {
    const { props } = setup({ chain: chain({ fallback_routes: [] }) });
    act(() => fallbackProps.onAddFallback());
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-mini', 'openai');
    });
    expect(props.persistFallbacks).toHaveBeenCalledWith(
      ['gpt-mini'],
      [{ provider: 'openai', authType: 'api_key', model: 'gpt-mini' }],
    );
  });

  it('reports a failed save without updating the list', async () => {
    const { props } = setup({ persistFallbacks: vi.fn().mockRejectedValue(new Error('x')) });
    act(() => fallbackProps.onAddFallback());
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-mini', 'openai', 'api_key');
    });
    expect(mockToast.error).toHaveBeenCalledWith('Failed to add fallback');
    expect(props.onFallbacksUpdate).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('auto-pins the only remaining key for a fallback of a multi-key provider', async () => {
    const keys = [
      key({ id: 'a', label: 'Personal', priority: 0 }),
      key({ id: 'b', label: 'Work', priority: 1 }),
    ];
    // The primary already uses model gpt-5.5 with the first key; picking gpt-5.5 as fallback leaves Work.
    const { props } = setup({
      connectedProviders: keys,
      chain: chain({
        override_route: {
          provider: 'openai',
          authType: 'api_key',
          model: 'gpt-5.5',
          keyLabel: 'Personal',
        },
        fallback_routes: [],
      }),
    });
    act(() => fallbackProps.onAddFallback());
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-5.5', 'openai', 'api_key');
    });
    expect(props.persistFallbacks).toHaveBeenCalledWith(
      ['gpt-5.5'],
      [{ provider: 'openai', authType: 'api_key', model: 'gpt-5.5', keyLabel: 'Work' }],
    );
    expect(screen.queryByRole('dialog', { name: 'key picker' })).toBeNull();
  });

  it('ignores a fallback pick when every key is already used for that model', async () => {
    const keys = [
      key({ id: 'a', label: 'Personal', priority: 0 }),
      key({ id: 'b', label: 'Work', priority: 1 }),
    ];
    const { props } = setup({
      connectedProviders: keys,
      chain: chain({
        override_route: {
          provider: 'openai',
          authType: 'api_key',
          model: 'gpt-5.5',
          keyLabel: 'Personal',
        },
        fallback_routes: [
          { provider: 'openai', authType: 'api_key', model: 'gpt-5.5', keyLabel: 'Work' },
        ],
      }),
    });
    act(() => fallbackProps.onAddFallback());
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-5.5', 'openai', 'api_key');
    });
    expect(props.persistFallbacks).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'key picker' })).toBeNull();
  });
});

describe('RouteChainCard picking the primary', () => {
  it('opens the picker from the chip and from the pencil, without double handling', () => {
    const { container } = setup();
    fireEvent.click(container.querySelector('.routing-card__model-chip')!);
    expect(screen.getByRole('dialog', { name: 'model picker' })).toBeTruthy();
    act(() => pickerProps!.onClose());
    expect(screen.queryByRole('dialog', { name: 'model picker' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change model for My chain' }));
    expect(screen.getByRole('dialog', { name: 'model picker' })).toBeTruthy();
  });

  it('overrides directly when the provider has a single key', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change model for My chain' }));
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-new', 'openai', 'api_key');
    });
    expect(props.onOverride).toHaveBeenCalledWith('gpt-new', 'openai', 'api_key');
    expect(screen.queryByRole('dialog', { name: 'model picker' })).toBeNull();
  });

  it('asks which key to pin when a multi-key provider is picked, then overrides with the label', async () => {
    const keys = [
      key({ id: 'a', label: 'Personal', priority: 0 }),
      key({ id: 'b', label: 'Work', priority: 1 }),
    ];
    const { props } = setup({ connectedProviders: keys });
    fireEvent.click(screen.getByRole('button', { name: 'Change model for My chain' }));
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-new', 'openai', 'api_key');
    });
    expect(screen.getByRole('dialog', { name: 'key picker' })).toBeTruthy();
    expect(keyModalProps!.keys.map((k: RoutingProvider) => k.label)).toEqual(['Personal', 'Work']);
    expect(keyModalProps!.modelName).toBe('gpt-new');
    expect(props.onOverride).not.toHaveBeenCalled();
    act(() => keyModalProps!.onPick('Work'));
    expect(props.onOverride).toHaveBeenCalledWith('gpt-new', 'openai', 'api_key', 'Work');
    expect(screen.queryByRole('dialog', { name: 'key picker' })).toBeNull();
  });

  it('leaves the pin on Auto when the key picker answers null', async () => {
    const keys = [
      key({ id: 'a', label: 'Personal' }),
      key({ id: 'b', label: 'Work', priority: 1 }),
    ];
    const { props } = setup({ connectedProviders: keys });
    fireEvent.click(screen.getByRole('button', { name: 'Change model for My chain' }));
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-new', 'openai', 'api_key');
    });
    act(() => keyModalProps!.onPick(null));
    expect(props.onOverride).toHaveBeenCalledWith('gpt-new', 'openai', 'api_key');
  });

  it('can dismiss the key picker without changing anything', async () => {
    const keys = [
      key({ id: 'a', label: 'Personal' }),
      key({ id: 'b', label: 'Work', priority: 1 }),
    ];
    const { props } = setup({ connectedProviders: keys });
    fireEvent.click(screen.getByRole('button', { name: 'Change model for My chain' }));
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-new', 'openai', 'api_key');
    });
    act(() => keyModalProps!.onClose());
    expect(screen.queryByRole('dialog', { name: 'key picker' })).toBeNull();
    expect(props.onOverride).not.toHaveBeenCalled();
  });

  it('names a custom provider in the key picker', async () => {
    const keys = [
      key({ id: 'a', provider: 'custom:cp1', label: 'One' }),
      key({ id: 'b', provider: 'custom:cp1', label: 'Two', priority: 1 }),
    ];
    setup({
      connectedProviders: keys,
      customProviders: [{ id: 'cp1', name: 'Acme Gateway' } as never],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change model for My chain' }));
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'm', 'custom:cp1', 'api_key');
    });
    expect(keyModalProps!.providerName).toBe('Acme Gateway');
  });
});

describe('RouteChainCard key chip and params', () => {
  it('shows the key chip only for a multi-key primary, and re-pins through onOverride', async () => {
    const keys = [
      key({ id: 'a', label: 'Personal' }),
      key({ id: 'b', label: 'Work', priority: 1 }),
    ];
    const { props, unmount } = setup({ connectedProviders: keys });
    expect(screen.getByTestId('key-chip')).toBeTruthy();
    await act(async () => {
      await keyChipProps!.onPick('Work');
    });
    expect(props.onOverride).toHaveBeenCalledWith('gpt-5.5', 'openai', 'api_key', 'Work');
    await act(async () => {
      await keyChipProps!.onPick(null);
    });
    expect(props.onOverride).toHaveBeenLastCalledWith('gpt-5.5', 'openai', 'api_key', undefined);
    unmount();
    setup({ connectedProviders: [key()] });
    expect(screen.queryByTestId('key-chip')).toBeNull();
  });

  it('shows the params affordance only when both getter and setter are given and auth is not local', () => {
    const getModelParams = vi.fn();
    const setModelParams = vi.fn();
    const { unmount } = setup({ getModelParams, setModelParams });
    expect(screen.getByTestId('params-affordance')).toBeTruthy();
    expect(paramsProps).toMatchObject({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-5.5',
      scope: 'header:tier-1',
      agentName: 'demo',
    });
    unmount();

    const onlyGetter = setup({ getModelParams });
    expect(onlyGetter.queryByTestId('params-affordance')).toBeNull();
    onlyGetter.unmount();

    const local = setup({
      getModelParams,
      setModelParams,
      chain: chain({ override_route: { provider: 'ollama', authType: 'local', model: 'llama' } }),
      models: [],
    });
    expect(local.queryByTestId('params-affordance')).toBeNull();
  });
});

describe('RouteChainCard options menu', () => {
  it('toggles the menu from the gear button and closes via the provided callback', () => {
    setup();
    const gear = screen.getByRole('button', { name: 'Options for My chain' });
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('menu-item')).toBeNull();
    fireEvent.click(gear);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('menu-item'));
    expect(screen.queryByText('menu-item')).toBeNull();
    fireEvent.click(gear);
    fireEvent.click(gear);
    expect(screen.queryByText('menu-item')).toBeNull();
  });

  it('closes the menu on an outside click and on Escape', () => {
    setup();
    const gear = screen.getByRole('button', { name: 'Options for My chain' });
    fireEvent.click(gear);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('menu-item')).toBeNull();
    fireEvent.click(gear);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('menu-item')).toBeNull();
  });

  it('renders the title slots: leading, extra, and a replacement for the plain name', () => {
    setup({
      titleLeading: <span>drag</span>,
      titleExtra: <span>extra</span>,
      titleContent: <span>custom title</span>,
      details: <p>detail row</p>,
    });
    expect(screen.getByText('drag')).toBeTruthy();
    expect(screen.getByText('extra')).toBeTruthy();
    expect(screen.getByText('custom title')).toBeTruthy();
    expect(screen.queryByText('My chain')).toBeNull();
    expect(screen.getByText('detail row')).toBeTruthy();
  });
});

describe('RouteChainCard in pt-BR', () => {
  it('translates the add button and the fallback toast', async () => {
    resetLocaleForTests('pt-BR');
    const { props } = setup({ chain: chain({ override_route: null, fallback_routes: null }) });
    expect(screen.getByRole('button', { name: '+ Adicionar modelo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Add model' })).toBeNull();
    expect(props.onOverride).not.toHaveBeenCalled();
  });

  it('toasts the translated confirmation after adding a fallback', async () => {
    resetLocaleForTests('pt-BR');
    setup();
    act(() => fallbackProps.onAddFallback());
    await act(async () => {
      await pickerProps!.onSelect('tier-1', 'gpt-mini', 'openai', 'api_key');
    });
    expect(mockToast.success).toHaveBeenCalledWith('Fallback adicionado');
  });
});
