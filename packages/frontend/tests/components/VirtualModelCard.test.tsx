import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

const mockClearOverride = vi.fn().mockResolvedValue(undefined);
const mockSetFallbacks = vi.fn().mockResolvedValue([]);
const mockClearFallbacks = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/api/virtual-models.js', () => ({
  clearVirtualModelOverride: (...a: unknown[]) => mockClearOverride(...a),
  setVirtualModelFallbacks: (...a: unknown[]) => mockSetFallbacks(...a),
  clearVirtualModelFallbacks: (...a: unknown[]) => mockClearFallbacks(...a),
}));

vi.mock('../../src/services/api/model-params.js', () => ({ getModelParamSpecs: vi.fn() }));
vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: (id: string) => <span data-testid={`provider-icon-${id}`} />,
  customProviderLogo: () => null,
}));

let fallbackProps: Record<string, unknown> = {};
vi.mock('../../src/components/FallbackList.js', () => ({
  default: (props: Record<string, unknown>) => {
    fallbackProps = props;
    return <div data-testid="fallback-list" />;
  },
}));

import VirtualModelCard from '../../src/components/VirtualModelCard';
import type { VirtualModel } from '../../src/services/api/virtual-models';

const base: VirtualModel = {
  id: 'vm-1',
  agent_id: 'agent-1',
  name: 'deepseek/flash',
  sort_order: 0,
  enabled: true,
  override_route: { provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' },
  fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-5.5' }],
  continue_on_default: false,
  response_mode: 'buffered',
  output_modality: 'text',
  created_at: '',
  updated_at: '',
  shadows: [],
  context_length: 128000,
};

function renderCard(overrides: Partial<VirtualModel> = {}, extra: Record<string, unknown> = {}) {
  const handlers = {
    onOverride: vi.fn(),
    onFallbacksUpdate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onShowExample: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
  };
  const utils = render(
    <VirtualModelCard
      agentName="demo"
      virtualModel={{ ...base, ...overrides }}
      models={[]}
      customProviders={[]}
      connectedProviders={[]}
      {...handlers}
      {...extra}
    />,
  );
  return { ...utils, handlers };
}

describe('VirtualModelCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fallbackProps = {};
  });

  it('titles the card with the bare name and shows the primary and the fallbacks', () => {
    renderCard();
    expect(screen.queryByText('Virtual model:')).toBeNull();
    expect(screen.getByText('deepseek/flash')).toBeTruthy();
    expect(screen.queryByText('model: "deepseek/flash"')).toBeNull();
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
    expect(screen.getByTestId('fallback-list')).toBeTruthy();
    expect(fallbackProps.fallbacks).toEqual(['gpt-5.5']);
    expect(fallbackProps.modelParamsScope).toBe('virtual:vm-1');
  });

  it('keeps the switches out of the card', () => {
    renderCard();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('marks an inactive virtual model', () => {
    renderCard({ enabled: false });
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('warns about shadowed ids', () => {
    renderCard({ shadows: ['claude-sonnet-4-5', 'anthropic/claude-sonnet-4-5'] });
    expect(screen.getByText('Shadows 2 real models')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-4-5')).toBeTruthy();
    expect(screen.getByText(/hidden from \/v1\/models/)).toBeTruthy();
  });

  it('shows no warning without shadows', () => {
    renderCard();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('runs the menu actions', () => {
    const { handlers } = renderCard();
    const open = () => fireEvent.click(screen.getByLabelText('Options for deepseek/flash'));
    for (const [label, handler] of [
      ['Copy example', handlers.onShowExample],
      ['Edit virtual model', handlers.onEdit],
      ['Move up', handlers.onMoveUp],
      ['Move down', handlers.onMoveDown],
      ['Delete', handlers.onDelete],
    ] as const) {
      open();
      fireEvent.click(screen.getByText(label));
      expect(handler).toHaveBeenCalled();
    }
  });

  it('opens the example from the script icon', () => {
    const { handlers } = renderCard();
    fireEvent.click(screen.getByLabelText('Show how to use deepseek/flash'));
    expect(handlers.onShowExample).toHaveBeenCalled();
  });

  it('persists the chain through the virtual model API', async () => {
    renderCard();
    const persist = fallbackProps.persistFallbacks as (
      a: string,
      t: string,
      m: string[],
      r?: unknown,
    ) => Promise<unknown>;
    await persist('x', 'y', ['m'], undefined);
    expect(mockSetFallbacks).toHaveBeenCalledWith('demo', 'vm-1', ['m'], undefined);
    await (fallbackProps.persistClearFallbacks as () => Promise<unknown>)();
    expect(mockClearFallbacks).toHaveBeenCalledWith('demo', 'vm-1');
    // No Reset on virtual model cards: models are removed one by one.
    expect(screen.queryByText('Reset')).toBeNull();
  });
});
