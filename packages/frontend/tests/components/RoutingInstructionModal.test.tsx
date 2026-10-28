import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.stubGlobal('navigator', {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

const mockGetModelPrices = vi.fn();
const mockGetAgentKey = vi.fn();
vi.mock('../../src/services/api.js', () => ({
  getModelPrices: () => mockGetModelPrices(),
  getAgentKey: (n: string) => mockGetAgentKey(n),
}));

vi.mock('../../src/services/agent-platform-store.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return {
    agentPlatformSignal: signal({ platform: 'openclaw', category: null }),
    agentPlatform: () => 'openclaw',
    agentCategory: () => null,
  };
});

// Active virtual models load quietly next to the agent key.
vi.mock('../../src/services/api/virtual-models.js', () => ({
  listVirtualModels: () => Promise.resolve([]),
}));

vi.mock('thinker-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('thinker-shared')>();
  return { ...actual, platformIcon: () => undefined };
});

vi.mock('../../src/components/SetupStepAddProvider.jsx', () => ({
  default: (props: any) => (
    <div
      data-testid="setup-add-provider"
      data-base-url={props.baseUrl ?? ''}
      data-api-key={props.apiKey ?? ''}
      data-platform={props.platform ?? ''}
      data-key-prefix={props.keyPrefix ?? ''}
    >
      SetupStepAddProvider
    </div>
  ),
}));

import RoutingInstructionModal from '../../src/components/RoutingInstructionModal';

const testModels = {
  models: [
    { model_name: 'gpt-4o', provider: 'OpenAI' },
    { model_name: 'claude-sonnet-4', provider: 'Anthropic' },
    { model_name: 'gemini-2.5-flash', provider: 'Google' },
    { model_name: 'z-ai/glm-5', provider: 'OpenRouter' },
  ],
  lastSyncedAt: '2026-02-28T10:00:00Z',
};

describe('RoutingInstructionModal', () => {
  beforeEach(() => {
    mockGetModelPrices.mockResolvedValue(testModels);
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc', apiKey: 'thk_abc123' });
  });

  it('renders nothing when open is false', () => {
    render(
      <RoutingInstructionModal
        open={false}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('.overlay')).toBeNull();
  });

  it("shows 'Set up agent' title in enable mode", () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('test-agent')).toBeDefined();
  });

  it('shows SetupStepAddProvider in enable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('[data-testid="setup-add-provider"]')).not.toBeNull();
  });

  it("shows 'Deactivate routing' title in disable mode", () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Deactivate routing')).toBeDefined();
  });

  it('shows search input instead of model buttons in disable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('.routing-modal__search')).not.toBeNull();
    expect(document.body.querySelector('.routing-modal__inline-picker')).not.toBeNull();
  });

  it('shows terminal with placeholder before model is selected in disable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('.modal-terminal')).not.toBeNull();
    expect(document.body.textContent).toContain('<provider/model>');
    expect(document.body.textContent).toContain('openclaw config unset models.providers.thinker');
    expect(document.body.textContent).toContain(
      'openclaw config unset agents.defaults.models.thinker/auto',
    );
  });

  it('explains that this restores direct model access in disable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.textContent).toContain('restore direct model access');
  });

  it('updates command when a model is selected from dropdown', async () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(document.body.querySelector('.routing-modal__list')).not.toBeNull();
    });

    const buttons = document.body.querySelectorAll('.routing-modal__model');
    const gpt4oButton = Array.from(buttons).find(
      (btn) => btn.textContent?.includes('gpt-4o') && !btn.textContent?.includes('mini'),
    );
    expect(gpt4oButton).toBeDefined();
    fireEvent.click(gpt4oButton!);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('openai/gpt-4o');
    });
    expect(document.body.textContent).not.toContain('<provider/model>');
  });

  it('uses the provider heading for OpenRouter vendor-prefixed models', async () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(document.body.querySelector('.routing-modal__list')).not.toBeNull();
    });

    const groups = Array.from(document.body.querySelectorAll('.routing-modal__group'));
    const openRouterGroup = groups.find((group) =>
      group.querySelector('.routing-modal__group-name')?.textContent?.includes('OpenRouter'),
    );

    expect(openRouterGroup).toBeDefined();

    const glmButton = Array.from(openRouterGroup!.querySelectorAll('.routing-modal__model')).find(
      (button) => button.textContent?.includes('z-ai/glm-5'),
    );

    expect(glmButton).toBeDefined();
    fireEvent.click(glmButton!);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('openrouter/z-ai/glm-5');
    });
  });

  it('does not show model picker in enable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('.routing-modal__inline-picker')).toBeNull();
  });

  it('renders SetupStepAddProvider even when connectedProvider is set', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        connectedProvider="openai"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('[data-testid="setup-add-provider"]')).not.toBeNull();
  });

  it('renders SetupStepAddProvider when connectedProvider is null', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        connectedProvider={null}
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('[data-testid="setup-add-provider"]')).not.toBeNull();
  });

  it('shows restart command in disable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.textContent).toContain('openclaw gateway restart');
  });

  it('renders SetupStepAddProvider with platform in enable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    const el = document.body.querySelector('[data-testid="setup-add-provider"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('data-platform')).toBe('openclaw');
  });

  it('calls onClose when Done is clicked', () => {
    const onClose = vi.fn();
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not show terminal UI in enable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.querySelector('.modal-terminal')).toBeNull();
  });

  it('builds the disable command with placeholder model by default', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    // The disableCmd function interpolates the selected model (or placeholder)
    expect(document.body.textContent).toContain('openclaw config unset models.providers.thinker');
    expect(document.body.textContent).toContain(
      'openclaw config unset agents.defaults.models.thinker/auto',
    );
    expect(document.body.textContent).toContain(
      'openclaw config set agents.defaults.model.primary <provider/model>',
    );
    expect(document.body.textContent).toContain('openclaw gateway restart');
  });

  it('copies the disable command via copy button', async () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    const copyBtn = document.body.querySelector('.copy-btn');
    expect(copyBtn).not.toBeNull();
    fireEvent.click(copyBtn!);
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
    // Verify the copied text contains all four disable commands
    const copiedText = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(copiedText).toContain('openclaw config unset models.providers.thinker');
    expect(copiedText).toContain('openclaw config unset agents.defaults.models.thinker/auto');
    expect(copiedText).toContain('openclaw config set agents.defaults.model.primary');
    expect(copiedText).toContain('openclaw gateway restart');
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on overlay click', () => {
    const onClose = vi.fn();
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={onClose}
      />,
    );
    const overlay = document.body.querySelector('.overlay')!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when close button is clicked in disable mode', () => {
    const onClose = vi.fn();
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={onClose}
      />,
    );
    const closeBtn = document.body.querySelector('[aria-label="Close"]')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('passes apiKey to SetupStepAddProvider in enable mode', async () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    await vi.waitFor(() => {
      const el = document.body.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-api-key')).toBe('thk_abc123');
    });
  });

  it('shows unset command in disable mode', () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="disable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    expect(document.body.textContent).toContain('openclaw config unset models.providers.thinker');
  });

  it('passes null apiKey to SetupStepAddProvider when full key unavailable', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc', apiKey: null });
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    await vi.waitFor(() => {
      const el = document.body.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-api-key')).toBe('');
    });
  });

  it('passes full apiKey to SetupStepAddProvider when available', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc', apiKey: 'thk_abc123full' });
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    await vi.waitFor(() => {
      const el = document.body.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-api-key')).toBe('thk_abc123full');
    });
  });

  it('renders SetupStepAddProvider with correct props in enable mode', async () => {
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    await vi.waitFor(() => {
      const el = document.body.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-api-key')).toBe('thk_abc123');
      expect(el!.getAttribute('data-platform')).toBe('openclaw');
    });
  });

  it('passes null apiKey and keyPrefix when no key data', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: null, apiKey: null });
    render(
      <RoutingInstructionModal
        open={true}
        mode="enable"
        agentName="test-agent"
        onClose={() => {}}
      />,
    );
    await vi.waitFor(() => {
      const el = document.body.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-api-key')).toBe('');
      expect(el!.getAttribute('data-key-prefix')).toBe('');
    });
  });
});
