import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();
let mockPathname = '/harnesses';
vi.mock('react-router', async (orig) => ({
  ...(await orig<object>()),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

const mockCreateAgent = vi.fn();
vi.mock('../../src/services/api', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
}));

const mockGetLogRetention = vi.fn();
vi.mock('../../src/services/api/organizations', () => ({
  getLogRetention: (...args: unknown[]) => mockGetLogRetention(...args),
}));

const mockHighlightAgent = vi.fn();
vi.mock('../../src/services/recent-agents', () => ({
  highlightAgent: (...args: unknown[]) => mockHighlightAgent(...args),
}));

const mockRefreshAgents = vi.fn();
vi.mock('../../src/services/sse', () => ({
  refreshAgents: (...args: unknown[]) => mockRefreshAgents(...args),
}));

vi.mock('../../src/components/AgentTypeGrid', () => ({
  default: (props: any) => (
    <div
      data-testid="agent-type-picker"
      data-category={props.category ?? ''}
      data-platform={props.platform ?? ''}
      data-disabled={String(!!props.disabled)}
    >
      <button data-testid="pick-app" onClick={() => props.onCategoryChange('app')}>
        App
      </button>
      <button data-testid="pick-platform" onClick={() => props.onPlatformChange('langchain')}>
        P
      </button>
    </div>
  ),
}));

vi.mock('thinker-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('thinker-shared')>()),
  PLATFORMS_BY_CATEGORY: {
    personal: ['openclaw', 'hermes', 'other'],
    app: ['openai-sdk', 'vercel-ai-sdk', 'langchain', 'other'],
    coding: ['opencode', 'claude-code', 'other'],
  },
}));

import AddAgentModal from '../../src/components/AddAgentModal';

const renderOpen = () => {
  const onClose = vi.fn();
  const result = render(<AddAgentModal open={true} onClose={onClose} />);
  const input = document.querySelector('#agent-name-input') as HTMLInputElement;
  const createBtn = screen.getByText('Create');
  return { ...result, onClose, input, createBtn };
};

const openSettingsTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

describe('AddAgentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAgent.mockResolvedValue({ agent: { name: 'new-agent' }, apiKey: 'key-1' });
    mockPathname = '/harnesses';
  });

  it('renders nothing when closed', () => {
    const { container } = render(<AddAgentModal open={false} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the dialog title and description when open', () => {
    renderOpen();
    expect(document.body.textContent).toContain('Connect Harness');
    expect(document.body.textContent).toContain('Name your harness to start tracking');
  });

  it('offers only the logs toggle, with no Autofix switch or third-party legal line', async () => {
    const { input, createBtn } = renderOpen();
    openSettingsTab();
    const switches = document.querySelectorAll('[role="switch"]');
    expect(switches.length).toBe(1);
    expect(switches[0]!.getAttribute('aria-label')).toBe('Enable logs');
    expect(document.body.textContent).not.toContain('Autofix');
    expect(document.querySelector('a[href^="https://manifest.build"]')).toBeNull();

    fireEvent.change(input, { target: { value: 'first-agent' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => expect(mockCreateAgent).toHaveBeenCalled());
    // The modal sends no Autofix choice: the backend no longer has one.
    expect(mockCreateAgent.mock.calls[0]![0]).not.toHaveProperty('autofix_enabled');
  });

  describe('create races', () => {
    it('issues one create for rapid double submits', async () => {
      let resolveCreate!: (v: { agent: { name: string }; apiKey: string }) => void;
      mockCreateAgent.mockReturnValue(
        new Promise<{ agent: { name: string }; apiKey: string }>((r) => (resolveCreate = r)),
      );
      const { input, createBtn } = renderOpen();
      fireEvent.change(input, { target: { value: 'double-clicked' } });
      fireEvent.click(createBtn);
      fireEvent.click(createBtn);
      fireEvent.click(createBtn);

      resolveCreate({ agent: { name: 'double-clicked' }, apiKey: 'key-1' });
      await vi.waitFor(() => expect(mockCreateAgent).toHaveBeenCalled());
      expect(mockCreateAgent).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps Create disabled until a non-blank name is entered', () => {
    const { input, createBtn } = renderOpen();
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  ' } });
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'x' } });
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not submit when name is whitespace only', () => {
    const { input, createBtn } = renderOpen();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(createBtn);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('stays on the harness list and rings the new harness, with no success screen', async () => {
    const { input, createBtn, onClose } = renderOpen();
    fireEvent.change(input, { target: { value: 'agent-a' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => expect(mockHighlightAgent).toHaveBeenCalledWith('new-agent'));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('goes to the harness list when created from another page', async () => {
    mockPathname = '/overview';
    const { input, createBtn } = renderOpen();
    fireEvent.change(input, { target: { value: 'agent-b' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/harnesses'));
    expect(mockHighlightAgent).toHaveBeenCalledWith('new-agent');
  });

  it('refreshes the harness list as soon as creation succeeds', async () => {
    const { input, createBtn } = renderOpen();
    fireEvent.change(input, { target: { value: 'agent-a' } });
    fireEvent.click(createBtn);

    await vi.waitFor(() => {
      expect(mockRefreshAgents).toHaveBeenCalledTimes(1);
    });
  });

  it('falls back to the typed name when the server omits the slug', async () => {
    mockCreateAgent.mockResolvedValue({ apiKey: 'k' });
    const { input, createBtn } = renderOpen();
    fireEvent.change(input, { target: { value: 'Typed Name' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => expect(mockHighlightAgent).toHaveBeenCalledWith('typed-name'));
  });

  it('titles the window with the typed name', () => {
    const { input } = renderOpen();
    const title = () => document.querySelector('.floating-window-head')!.textContent;
    expect(title()).toContain('Connect Harness');
    fireEvent.change(input, { target: { value: 'my-bot' } });
    expect(title()).toBe('my-bot');
    fireEvent.change(input, { target: { value: '' } });
    expect(title()).toContain('Connect Harness');
  });

  it('shows the chosen type icon left of the title', () => {
    renderOpen();
    const icon = () =>
      document.querySelector('.floating-window-head .add-agent__title-icon')!.getAttribute('src');
    expect(icon()).toBe('/icons/providers/opencode.svg');
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    expect(icon()).toBe('/icons/providers/openai.svg');
  });

  it('sends the selected category and platform in the createAgent payload', async () => {
    const { input, createBtn } = renderOpen();
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    fireEvent.click(document.querySelector('[data-testid="pick-platform"]')!);
    fireEvent.change(input, { target: { value: 'typed' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith({
        name: 'typed',
        agent_category: 'app',
        agent_platform: 'langchain',
        record_messages: true,
        log_retention_days: null,
      });
    });
  });

  it('sends toggled-off recording when the user flips it', async () => {
    const { input, createBtn } = renderOpen();
    openSettingsTab();
    // The logs switch defaults on; flip it off before creating.
    const switches = Array.from(
      document.querySelectorAll('[role="switch"]'),
    ) as HTMLButtonElement[];
    expect(switches.length).toBe(1);
    fireEvent.click(switches[0]!);
    fireEvent.change(input, { target: { value: 'typed' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith({
        name: 'typed',
        agent_category: 'coding',
        agent_platform: expect.any(String),
        record_messages: false,
        log_retention_days: null,
      });
    });
  });

  it('labels the logs toggle and shows the local storage note', () => {
    renderOpen();
    openSettingsTab();
    expect(screen.getByText('Enable logs')).toBeTruthy();
    expect(document.body.textContent).toContain('Logs stay in your own database.');
    expect(document.body.textContent).not.toContain('Thinker workspace');
  });

  it('resets the category/platform to defaults when a category changes', () => {
    renderOpen();
    // Switch to app (platform becomes openai-sdk, first of app list).
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    const picker = document.querySelector('[data-testid="agent-type-picker"]')!;
    expect(picker.getAttribute('data-category')).toBe('app');
    expect(picker.getAttribute('data-platform')).toBe('openai-sdk');
  });

  it('disables the input and shows a spinner while creating', async () => {
    let resolveCreate: (v: unknown) => void;
    mockCreateAgent.mockReturnValue(
      new Promise((r) => {
        resolveCreate = r;
      }),
    );
    const { input, createBtn } = renderOpen();
    fireEvent.change(input, { target: { value: 'slow' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(input.disabled).toBe(true);
      expect(document.querySelector('.spinner')).not.toBeNull();
    });
    resolveCreate!({ agent: { name: 'slow' }, apiKey: 'k' });
  });

  it('does not highlight after the create resolves if the modal was dismissed mid-request (close button)', async () => {
    let resolveCreate: (v: unknown) => void;
    mockCreateAgent.mockReturnValue(
      new Promise((r) => {
        resolveCreate = r;
      }),
    );
    const { input } = renderOpen();
    fireEvent.change(input, { target: { value: 'dismissed' } });
    fireEvent.click(screen.getByText('Create'));
    await vi.waitFor(() => expect(mockCreateAgent).toHaveBeenCalled());

    // User closes the window while the request is still pending.
    fireEvent.click(screen.getByLabelText('Close'));

    // Now the in-flight request resolves — the post-success side effects and the
    // navigation must be skipped because the user already dismissed the modal.
    resolveCreate!({ agent: { name: 'dismissed' }, apiKey: 'k' });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockHighlightAgent).not.toHaveBeenCalled();
  });

  it('does not highlight after the create resolves if the modal was dismissed mid-request (Escape)', async () => {
    let resolveCreate: (v: unknown) => void;
    mockCreateAgent.mockReturnValue(
      new Promise((r) => {
        resolveCreate = r;
      }),
    );
    const { input } = renderOpen();
    fireEvent.change(input, { target: { value: 'esc-dismissed' } });
    fireEvent.click(screen.getByText('Create'));
    await vi.waitFor(() => expect(mockCreateAgent).toHaveBeenCalled());

    // Escape dismisses the modal while the create is still pending.
    fireEvent.keyDown(input, { key: 'Escape' });

    resolveCreate!({ agent: { name: 'esc-dismissed' }, apiKey: 'k' });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockHighlightAgent).not.toHaveBeenCalled();
  });

  it('still highlights on a normal (non-dismissed) successful create', async () => {
    // Guards against the dismissal flag wrongly suppressing a clean success: a
    // second create after a prior dismissal must reset the flag.
    const { input } = renderOpen();
    fireEvent.change(input, { target: { value: 'clean' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.change(input, { target: { value: 'clean' } });
    fireEvent.click(screen.getByText('Create'));
    await vi.waitFor(() => expect(mockHighlightAgent).toHaveBeenCalledWith('new-agent'));
  });

  it('does not navigate or highlight when createAgent rejects', async () => {
    mockCreateAgent.mockRejectedValue(new Error('boom'));
    const { input, createBtn } = renderOpen();
    fireEvent.change(input, { target: { value: 'fails' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalled();
    });
    expect(mockHighlightAgent).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('creates the agent on Enter from the name input', async () => {
    const { input } = renderOpen();
    fireEvent.change(input, { target: { value: 'enter-agent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'enter-agent' }),
      );
    });
  });

  it('does not create on Enter when focus is not the name input', () => {
    const { input } = renderOpen();
    fireEvent.change(input, { target: { value: 'x' } });
    // Enter dispatched on the dialog (not an input element) is ignored.
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: 'Enter' });
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('closes and resets the form on Escape', () => {
    const { input, onClose } = renderOpen();
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('is a floating window: no backdrop, and a click outside does not close it', () => {
    const { onClose } = renderOpen();
    expect(document.querySelector('.overlay')).toBeNull();
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on the close button', () => {
    const { onClose } = renderOpen();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('sends a custom log retention chosen in the Settings tab', async () => {
    const { input, createBtn } = renderOpen();
    openSettingsTab();
    fireEvent.click(document.querySelector('#add-agent-retention-custom')!);
    // Custom shows only the days field (no suggestions list); it commits on blur.
    expect(document.querySelector('#add-agent-retention-suggested')).toBeNull();
    const days = document.querySelector('#add-agent-retention-days') as HTMLInputElement;
    fireEvent.change(days, { target: { value: '7' } });
    fireEvent.blur(days);
    fireEvent.click(screen.getByRole('tab', { name: 'Harness' }));
    fireEvent.change(input, { target: { value: 'kept' } });
    fireEvent.click(createBtn);
    await vi.waitFor(() =>
      expect(mockCreateAgent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'kept', log_retention_days: 7 }),
      ),
    );
  });

  it('does not close when the modal card itself is clicked', () => {
    const { onClose } = renderOpen();
    fireEvent.mouseDown(document.querySelector('[role="dialog"]')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
