import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../src/services/api.js', () => ({
  connectProvider: vi.fn(),
  disconnectProvider: vi.fn().mockResolvedValue({ notifications: [] }),
  probeCustomProvider: vi.fn().mockResolvedValue({ models: [{ model_name: 'llama-3.1-8b' }] }),
  createCustomProvider: vi.fn().mockResolvedValue({ id: 'cp-1' }),
  deleteCustomProvider: vi.fn().mockResolvedValue({}),
  updateCustomProvider: vi.fn().mockResolvedValue({}),
  getLocalServerDefaults: vi.fn().mockResolvedValue([
    {
      type: 'ollama',
      display_name: 'Ollama',
      env: 'OLLAMA_HOST',
      default_port: 11434,
      config: {
        scheme: 'http',
        host: 'host.docker.internal',
        port: 11434,
        path_prefix: '',
        request_timeout_ms: 600000,
        probe_timeout_ms: 10000,
      },
    },
    {
      type: 'lmstudio',
      display_name: 'LM Studio',
      env: 'THINKER_LMSTUDIO_BASE_URL',
      default_port: 1234,
      config: {
        scheme: 'http',
        host: 'host.docker.internal',
        port: 1234,
        path_prefix: '',
        request_timeout_ms: 600000,
        probe_timeout_ms: 10000,
      },
    },
  ]),
  probeLocalServer: vi.fn().mockResolvedValue({
    version: '0.12.3',
    base_url: 'http://host.docker.internal:11434/v1',
    models: [
      { model_name: 'qwen3:8b', context_window: 40960, capabilities: ['tools'], loaded: true },
    ],
  }),
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkSignupEnabled: () => Promise.resolve(false),
  checkLocalLlmHost: vi.fn().mockResolvedValue('localhost'),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock('../../src/services/oauth-popup.js', () => ({
  monitorOAuthPopup: vi.fn(),
}));

vi.mock('../../src/components/CopilotDeviceLogin.js', () => ({
  default: (props: any) => (
    <div
      data-testid="copilot-device-login"
      data-agent={props.agentName}
      data-connected={String(props.connected)}
    >
      <button data-testid="copilot-connected" onClick={() => props.onConnected()}>
        Connected
      </button>
      <button data-testid="copilot-disconnected" onClick={() => props.onDisconnected()}>
        Disconnected
      </button>
      <button data-testid="copilot-back" onClick={() => props.onBack()}>
        Back
      </button>
    </div>
  ),
}));

import ProviderSelectContent from '../../src/components/ProviderSelectContent';

// NOTE: The provider list/tile view (header, footer, Subscription/API Keys/Local
// tabs, and clickable provider tiles) was removed from ProviderSelectContent on
// this branch — connection now happens via deep links from the dedicated
// Subscriptions / Usage-based / Local provider pages. The component renders
// ONLY a detail view, driven by `providerDeepLink` or `customProviderPrefill`.
// These tests therefore enter every flow through a deep link / prefill rather
// than by clicking a tile that no longer exists.

describe('ProviderSelectContent', () => {
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no deep link or prefill is provided', () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );
    // The list view is gone; with no deep link there is no detail view either.
    expect(container.querySelector('.provider-modal__view--from-right')).toBeNull();
  });

  it('hides header when showHeader is false', () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        onUpdate={onUpdate}
        showHeader={false}
      />,
    );
    expect(container.querySelector('.routing-modal__header')).toBeNull();
  });

  it('hides footer when showFooter is false', () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        onUpdate={onUpdate}
        showFooter={false}
      />,
    );
    expect(container.querySelector('.provider-modal__footer')).toBeNull();
  });

  it('opens the Z.ai subscription detail directly via a deep link', async () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'zai', authType: 'subscription' }}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByText('Z.ai')).toBeDefined();
    await waitFor(() => {
      const input = container.querySelector('input[placeholder="Paste your Z.ai API key"]');
      expect(input).not.toBeNull();
    });
  });

  it("shows 'Get Z.ai API key' link in the Z.ai subscription detail view", async () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'zai', authType: 'subscription' }}
        onUpdate={onUpdate}
      />,
    );
    await waitFor(() => {
      const link = container.querySelector<HTMLAnchorElement>(
        'a[href="https://z.ai/manage-apikey/apikey-list"]',
      );
      expect(link).not.toBeNull();
      expect(link!.textContent).toContain('Z.ai');
    });
  });

  it("shows 'Get Kimi Code API key' link to the Kimi Code console in the Moonshot subscription detail view", async () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'moonshot', authType: 'subscription' }}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByText('Moonshot')).toBeDefined();
    await waitFor(() => {
      const link = container.querySelector<HTMLAnchorElement>(
        'a[href="https://www.kimi.com/code/console"]',
      );
      expect(link).not.toBeNull();
      expect(link!.textContent).toContain('Kimi Code');
    });
  });

  it("shows 'Get ModelArk Coding Plan API key' link to the BytePlus console", async () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'byteplus', authType: 'subscription' }}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByText('BytePlus')).toBeDefined();
    await waitFor(() => {
      const link = container.querySelector<HTMLAnchorElement>(
        'a[href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey"]',
      );
      expect(link).not.toBeNull();
      expect(link!.textContent).toContain('ModelArk Coding Plan');
    });
  });

  it('shows only the Command Code key-form link to Studio', async () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'commandcode', authType: 'subscription' }}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByText('Command Code')).toBeDefined();
    await waitFor(() => {
      const link = container.querySelector<HTMLAnchorElement>(
        'a[href="https://commandcode.ai/studio"]',
      );
      expect(link).not.toBeNull();
      expect(link!.textContent).toContain('Command Code');
    });
    // The Pro-or-higher requirement note is shown for the subscription view.
    expect(screen.getByText('Requires Command Code Pro or higher.')).toBeDefined();
    // No external sign-in button and no separate api-keys settings link — the
    // only link is the Studio key-form link asserted above.
    expect(container.querySelector('.provider-detail__signin-btn')).toBeNull();
    expect(
      container.querySelector('a[href="https://commandcode.ai/studio/settings/api-keys"]'),
    ).toBeNull();
  });

  it("calls onClose when the deep-link detail view's Back button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'zai', authType: 'subscription' }}
        onUpdate={onUpdate}
        onClose={onClose}
      />,
    );
    const backBtn = container.querySelector('.modal-back-btn') as HTMLButtonElement;
    fireEvent.click(backBtn);
    // A deep-link entry has no list view to return to → Back dismisses the modal.
    expect(onClose).toHaveBeenCalled();
  });

  it('does not throw when onClose is omitted and Back is clicked', () => {
    const { container } = render(
      <ProviderSelectContent
        agentName="test-agent"
        providers={[]}
        providerDeepLink={{ providerId: 'zai', authType: 'subscription' }}
        onUpdate={onUpdate}
      />,
    );
    const backBtn = container.querySelector('.modal-back-btn') as HTMLButtonElement;
    expect(() => fireEvent.click(backBtn)).not.toThrow();
  });

  describe('local servers', () => {
    const lmsServer = {
      id: 'cp-lms',
      name: 'LM Studio Mac',
      base_url: 'http://192.168.1.30:1234/v1',
      local_type: 'lmstudio' as const,
      local_config: {
        scheme: 'http' as const,
        host: '192.168.1.30',
        port: 1234,
        path_prefix: '',
        request_timeout_ms: 600_000,
        probe_timeout_ms: 10_000,
      },
      models: [
        {
          model_name: 'llama',
          input_price_per_million_tokens: 0,
          output_price_per_million_tokens: 0,
        },
      ],
    };

    it('opens a local server in the server editor with its settings', async () => {
      const { container } = render(
        <ProviderSelectContent
          agentName="test-agent"
          providers={[]}
          customProviders={[lmsServer] as never}
          providerDeepLink={{ providerId: 'custom:cp-lms' }}
          onUpdate={onUpdate}
        />,
      );
      await waitFor(() => {
        expect(container.textContent).toContain('Edit LM Studio server');
      });
      expect((container.querySelector('#ls-lmstudio-host') as HTMLInputElement).value).toBe(
        '192.168.1.30',
      );
    });

    it('saves edited settings through updateCustomProvider with zero prices', async () => {
      const api = await import('../../src/services/api.js');
      const onUpdateLocal = vi.fn().mockResolvedValue(undefined);
      const { container } = render(
        <ProviderSelectContent
          agentName="test-agent"
          providers={[]}
          customProviders={[lmsServer] as never}
          providerDeepLink={{ providerId: 'custom:cp-lms' }}
          onUpdate={onUpdateLocal}
          onClose={vi.fn()}
        />,
      );
      const port = await waitFor(() => {
        const el = container.querySelector('#ls-lmstudio-port') as HTMLInputElement | null;
        if (!el) throw new Error('form not rendered');
        return el;
      });
      fireEvent.change(port, { target: { value: '4321' } });
      fireEvent.click(screen.getByText('Save changes'));
      await waitFor(() => expect(onUpdateLocal).toHaveBeenCalled());
      expect(api.updateCustomProvider).toHaveBeenCalledWith(
        'test-agent',
        'cp-lms',
        expect.objectContaining({
          local_config: expect.objectContaining({ host: '192.168.1.30', port: 4321 }),
          models: [
            {
              model_name: 'llama',
              input_price_per_million_tokens: 0,
              output_price_per_million_tokens: 0,
            },
          ],
        }),
      );
    });

    it('adds a server from a type deep link: defaults, test, then create', async () => {
      const api = await import('../../src/services/api.js');
      const { container } = render(
        <ProviderSelectContent
          agentName="test-agent"
          providers={[]}
          customProviders={[{ ...lmsServer, id: 'x', name: 'Ollama' }] as never}
          providerDeepLink={{ providerId: 'ollama' }}
          onUpdate={onUpdate}
          onClose={vi.fn()}
        />,
      );
      const name = await waitFor(() => {
        const el = container.querySelector('#ls-ollama-name') as HTMLInputElement | null;
        if (!el) throw new Error('form not rendered');
        return el;
      });
      expect(name.value).toBe('Ollama 2');
      expect((container.querySelector('#ls-ollama-port') as HTMLInputElement).value).toBe('11434');
      fireEvent.click(screen.getByText('Test connection'));
      await waitFor(() => expect(container.textContent).toContain('qwen3:8b'));
      expect(container.textContent).toContain('40,960 ctx');
      fireEvent.click(screen.getByText('Connect 1 model'));
      await waitFor(() =>
        expect(api.createCustomProvider).toHaveBeenCalledWith(
          'test-agent',
          expect.objectContaining({
            name: 'Ollama 2',
            local_type: 'ollama',
            local_config: expect.objectContaining({ host: 'host.docker.internal', port: 11434 }),
          }),
        ),
      );
    });
  });

  describe('CustomProviderForm callbacks', () => {
    // The form itself is tested in its own spec; here we only verify the
    // wiring: ProviderSelectContent must dismiss the form view and call
    // onUpdate whenever the form fires onCreated or onDeleted. The form is now
    // reached via a customProviderPrefill (the "Add custom provider" list
    // button was removed with the list view).
    beforeEach(() => {
      vi.doMock('../../src/components/CustomProviderForm.js', () => ({
        default: (p: {
          agentName: string;
          onCreated: () => void;
          onDeleted?: () => void;
          onBack: () => void;
          initialData?: { id: string; name: string };
          prefill?: unknown;
        }) => (
          // Read every prop on render so JSX getters fire — otherwise
          // Solid's lazy prop evaluation leaves the prefill ternary
          // branches unexercised in coverage.
          <div
            data-testid="custom-provider-form"
            data-agent={p.agentName}
            data-has-initial={p.initialData ? 'yes' : 'no'}
            data-has-prefill={p.prefill !== undefined ? 'yes' : 'no'}
          >
            <button data-testid="form-created" onClick={() => p.onCreated()}>
              fire onCreated
            </button>
            <button data-testid="form-deleted" onClick={() => p.onDeleted?.()}>
              fire onDeleted
            </button>
            <button data-testid="form-back" onClick={() => p.onBack()}>
              fire onBack
            </button>
          </div>
        ),
      }));
    });

    afterEach(() => {
      vi.doUnmock('../../src/components/CustomProviderForm.js');
    });

    it('dismisses the form and calls onUpdate when the form fires onCreated', async () => {
      vi.resetModules();
      const { default: Fresh } = await import('../../src/components/ProviderSelectContent');
      const onUpdateLocal = vi.fn();
      const { container } = render(
        <Fresh
          agentName="test-agent"
          providers={[]}
          customProviderPrefill={{ name: 'My Endpoint', baseUrl: 'https://api.example.com/v1' }}
          onUpdate={onUpdateLocal}
        />,
      );

      // A prefill opens the custom-provider form immediately.
      await waitFor(() => {
        expect(container.querySelector('[data-testid="custom-provider-form"]')).not.toBeNull();
      });

      fireEvent.click(screen.getByTestId('form-created'));

      await waitFor(() => {
        expect(onUpdateLocal).toHaveBeenCalled();
        expect(container.querySelector('[data-testid="custom-provider-form"]')).toBeNull();
      });
    });

    it('opens the form in edit mode (initialData set, prefill suppressed) for a non-local custom provider', async () => {
      vi.resetModules();
      const { default: Fresh } = await import('../../src/components/ProviderSelectContent');
      const customRow = {
        id: 'cp-my-groq',
        name: 'My Groq',
        base_url: 'https://api.groq.example/v1',
        models: [
          {
            model_name: 'llama-3.1-70b',
            input_price_per_million_tokens: 0,
            output_price_per_million_tokens: 0,
          },
        ],
      };

      const { container } = render(
        <Fresh
          agentName="test-agent"
          providers={[]}
          customProviders={[customRow]}
          providerDeepLink={{ providerId: 'custom:cp-my-groq' }}
          onUpdate={onUpdate}
        />,
      );

      // The mocked CustomProviderForm is mounted (not the LocalServerDetailView),
      // confirming the edit path falls through to the generic form for a
      // name that doesn't map to any defaultLocalPort provider.
      await waitFor(() => {
        const form = container.querySelector('[data-testid="custom-provider-form"]');
        expect(form).not.toBeNull();
        // Edit mode: initialData must be forwarded and prefill must be
        // suppressed (the form shouldn't receive a partial prefill on top
        // of an existing row).
        expect(form!.getAttribute('data-has-initial')).toBe('yes');
        expect(form!.getAttribute('data-has-prefill')).toBe('no');
      });
    });

    it('dismisses the form and calls onUpdate when the form fires onDeleted', async () => {
      vi.resetModules();
      const { default: Fresh } = await import('../../src/components/ProviderSelectContent');
      const onUpdateLocal = vi.fn();
      const { container } = render(
        <Fresh
          agentName="test-agent"
          providers={[]}
          customProviderPrefill={{ name: 'My Endpoint', baseUrl: 'https://api.example.com/v1' }}
          onUpdate={onUpdateLocal}
        />,
      );

      await waitFor(() => {
        expect(container.querySelector('[data-testid="custom-provider-form"]')).not.toBeNull();
      });

      fireEvent.click(screen.getByTestId('form-deleted'));

      await waitFor(() => {
        expect(onUpdateLocal).toHaveBeenCalled();
        expect(container.querySelector('[data-testid="custom-provider-form"]')).toBeNull();
      });
    });
  });

  describe('CopilotDeviceLogin callbacks', () => {
    // The device-login view is reached via a copilot deep link (the
    // "GitHub Copilot" tile was removed with the list view).
    it('calls onUpdate and dismisses via onClose when onConnected fires', async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();
      const { container } = render(
        <ProviderSelectContent
          agentName="test-agent"
          providers={[]}
          providerDeepLink={{ providerId: 'copilot', authType: 'subscription' }}
          onUpdate={onUpdate}
          onClose={onClose}
        />,
      );

      // The CopilotDeviceLogin mock is visible directly from the deep link.
      await waitFor(() => {
        expect(container.querySelector('[data-testid="copilot-device-login"]')).not.toBeNull();
      });

      // Click the onConnected button
      fireEvent.click(screen.getByTestId('copilot-connected'));

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled();
      });

      // onConnected → goBack, which (with a deep-link entry) calls onClose.
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('calls onUpdate and dismisses via onClose when onDisconnected fires', async () => {
      const onUpdate = vi.fn();
      const onClose = vi.fn();
      const { container } = render(
        <ProviderSelectContent
          agentName="test-agent"
          providers={[]}
          providerDeepLink={{ providerId: 'copilot', authType: 'subscription' }}
          onUpdate={onUpdate}
          onClose={onClose}
        />,
      );

      await waitFor(() => {
        expect(container.querySelector('[data-testid="copilot-device-login"]')).not.toBeNull();
      });

      // Click the onDisconnected button
      fireEvent.click(screen.getByTestId('copilot-disconnected'));

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled();
      });

      // onDisconnected → goBack, which (with a deep-link entry) calls onClose.
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
