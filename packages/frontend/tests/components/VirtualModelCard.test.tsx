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

let managerProps: Record<string, any> | null = null;
vi.mock('../../src/components/ModelChainManager.js', () => ({
  default: (props: Record<string, unknown>) => {
    managerProps = props;
    return <div role="dialog" aria-label="model manager" />;
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
    managerProps = null;
  });

  it('titles the card with the bare name and shows the primary and the fallbacks', () => {
    renderCard();
    expect(screen.queryByText('Virtual model:')).toBeNull();
    expect(screen.getByText('deepseek/flash')).toBeTruthy();
    expect(screen.queryByText('model: "deepseek/flash"')).toBeNull();
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
    expect(screen.getByText('gpt-5.5')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    const save = managerProps!.onSave as (routes: unknown[]) => Promise<void>;
    const fallback = { provider: 'openai', authType: 'api_key', model: 'm' };
    await save([{ provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' }, fallback]);
    expect(mockSetFallbacks).toHaveBeenCalledWith('demo', 'vm-1', ['m'], [fallback]);
    await save([{ provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' }]);
    expect(mockClearFallbacks).toHaveBeenCalledWith('demo', 'vm-1');
    await save([]);
    expect(mockClearOverride).toHaveBeenCalledWith('demo', 'vm-1');
    // No Reset on virtual model cards: the chain is edited in the manager.
    expect(screen.queryByText('Reset')).toBeNull();
  });
});
