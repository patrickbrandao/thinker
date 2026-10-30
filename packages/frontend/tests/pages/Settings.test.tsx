import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';

let mockAgentName = 'test-agent';
const mockNavigate = vi.fn();
vi.mock('react-router', async (orig) => ({
  ...(await orig<object>()),
  useParams: () => ({ agentName: mockAgentName }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: `/harnesses/${mockAgentName}/settings`, state: null }),
}));

const mockGetAgentKey = vi.fn();
const mockGetAgentInfo = vi.fn();
const mockDeleteAgent = vi.fn();
const mockRenameAgent = vi.fn();
const mockRotateAgentKey = vi.fn();
const mockUpdateAgent = vi.fn();
const mockGetRecording = vi.fn(() => Promise.resolve({ enabled: false }));
const mockUpdateRecording = vi.fn(() => Promise.resolve({ enabled: false }));
vi.mock('../../src/services/api', () => ({
  getAgentKey: (...args: unknown[]) => mockGetAgentKey(...args),
  getAgentInfo: (...args: unknown[]) => mockGetAgentInfo(...args),
  deleteAgent: (...args: unknown[]) => mockDeleteAgent(...args),
  renameAgent: (...args: unknown[]) => mockRenameAgent(...args),
  rotateAgentKey: (...args: unknown[]) => mockRotateAgentKey(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  getRecording: (...args: unknown[]) => mockGetRecording(...args),
  updateRecording: (...args: unknown[]) => mockUpdateRecording(...args),
  getModelListing: () => Promise.resolve({ mode: 'open' }),
  updateModelListing: (_agent: string, mode: string) => Promise.resolve({ mode }),
}));

vi.mock('../../src/services/api/virtual-models', () => ({
  listVirtualModels: () => Promise.resolve([]),
}));

vi.mock('../../src/services/toast-store', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/components/ErrorState', () => ({
  default: (props: any) => (
    <div data-testid="error-state" data-error={String(props.error ?? '')}>
      {props.title ?? 'Something went wrong'}
    </div>
  ),
}));

vi.mock('../../src/components/CopyButton', () => ({
  default: () => <button>Copy</button>,
}));

vi.mock('../../src/components/AgentTypeGrid', () => ({
  default: (props: any) => (
    <div
      data-testid="agent-type-picker"
      data-category={props.category ?? ''}
      data-platform={props.platform ?? ''}
      data-disabled={String(!!props.disabled)}
    >
      <button
        data-testid="pick-app"
        onClick={() => {
          props.onCategoryChange('app');
        }}
      >
        Pick App
      </button>
      <button
        data-testid="pick-platform"
        onClick={() => {
          props.onPlatformChange('openai-sdk');
        }}
      >
        Pick Platform
      </button>
    </div>
  ),
}));

let mockSetupThrows = false;
vi.mock('../../src/components/SetupStepAddProvider', () => ({
  default: (props: any) => {
    if (mockSetupThrows) throw new Error('render crash');
    return (
      <div
        data-testid="setup-add-provider"
        data-base-url={props.baseUrl ?? ''}
        data-key={props.apiKey ?? ''}
        data-platform={props.platform ?? ''}
        data-key-prefix={props.keyPrefix ?? ''}
      />
    );
  },
}));

const mockMarkAgentCreated = vi.fn();
vi.mock('../../src/services/recent-agents', () => ({
  markAgentCreated: (...args: unknown[]) => mockMarkAgentCreated(...args),
}));

vi.mock('thinker-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('thinker-shared')>()),
  AGENT_CATEGORIES: ['personal', 'app', 'coding'],
  platformIcon: (plat: string | null, cat: string | null) => {
    if (!plat) return undefined;
    if (plat === 'other') return cat === 'personal' ? '/icons/other-agent.svg' : '/icons/other.svg';
    const icons: Record<string, string> = {
      openclaw: '/icons/openclaw.png',
      hermes: '/icons/hermes.png',
      'openai-sdk': '/icons/providers/openai.svg',
      'vercel-ai-sdk': '/icons/vercel.svg',
      langchain: '/icons/langchain.svg',
      'claude-code': '/icons/providers/claude-code.svg',
    };
    return icons[plat];
  },
  CATEGORY_LABELS: {
    personal: 'AI agent',
    app: 'App AI SDK',
    coding: 'Coding Assistant',
  },
  PLATFORM_LABELS: {
    openclaw: 'OpenClaw',
    hermes: 'Hermes Agent',
    'openai-sdk': 'OpenAI SDK',
    'vercel-ai-sdk': 'Vercel AI SDK',
    langchain: 'LangChain',
    curl: 'cURL',
    'claude-code': 'Claude Code',
    other: 'Other',
  },
  PLATFORMS_BY_CATEGORY: {
    personal: ['openclaw', 'hermes', 'other'],
    app: ['openai-sdk', 'vercel-ai-sdk', 'langchain', 'other'],
    coding: ['claude-code', 'other'],
  },
  PLATFORM_ICONS: {
    openclaw: '/icons/openclaw.png',
    hermes: '/icons/hermes.png',
    'openai-sdk': '/icons/providers/openai.svg',
    'vercel-ai-sdk': '/icons/vercel.svg',
    langchain: '/icons/langchain.svg',
    'claude-code': '/icons/providers/claude-code.svg',
  },
}));

// SetupModal belongs to another area; a stand-in keeps the "opens after save" contract.
vi.mock('../../src/components/SetupModal', () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div role="dialog">Set up harness</div> : null,
}));

vi.mock('../../src/services/agent-platform-store', () => ({
  setAgentPlatform: vi.fn(),
}));

import Settings from '../../src/pages/Settings';

const render = (ui: () => React.ReactElement) => rtlRender(ui());

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentName = 'test-agent';
    mockSetupThrows = false;
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc' });
    mockGetAgentInfo.mockResolvedValue({
      agent_name: 'test-agent',
      agent_category: 'personal',
      agent_platform: 'openclaw',
    });
    mockDeleteAgent.mockResolvedValue(undefined);
    mockRenameAgent.mockResolvedValue({ renamed: true, name: 'new-name' });
    mockRotateAgentKey.mockResolvedValue({ apiKey: 'new-key' });
    mockUpdateAgent.mockResolvedValue({});
  });

  it('does not render a duplicate page heading', () => {
    const { container } = render(() => <Settings />);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('renders agent name input with value', () => {
    render(() => <Settings />);
    const input = screen.getByLabelText('Harness name') as HTMLInputElement;
    expect(input.value).toBe('test-agent');
  });

  it('renders Harness type label', () => {
    render(() => <Settings />);
    expect(screen.getByText('Harness type')).toBeDefined();
  });

  it('applies the platform-icon theming class to the harness type icon', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.querySelector('img.settings-type__icon')).not.toBeNull();
    });
    const icon = container.querySelector('img.settings-type__icon');
    expect(icon?.classList.contains('platform-icon')).toBe(true);
  });

  it('renders Change button for agent type', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
  });

  it('renders API Key section', () => {
    render(() => <Settings />);
    expect(screen.getByText('Harness API key')).toBeDefined();
  });

  it('renders Setup section', () => {
    render(() => <Settings />);
    expect(screen.getByText('Setup')).toBeDefined();
  });

  it('has no Autofix section or third-party terms link', () => {
    const { container } = render(() => <Settings />);
    expect(container.textContent).not.toMatch(/autofix/i);
    expect(container.querySelector('a[href^="https://manifest.build"]')).toBeNull();
  });

  it('renders Danger zone', () => {
    render(() => <Settings />);
    expect(screen.getByText('Danger zone')).toBeDefined();
  });

  it('renders Delete harness button', () => {
    render(() => <Settings />);
    expect(screen.getByText('Delete harness')).toBeDefined();
  });

  it('shows key prefix after loading', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('thk_abc');
    });
  });

  it('shows reveal button when API returns full key', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc', apiKey: 'thk_full_key_123' });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Reveal API key"]')).not.toBeNull();
    });
  });

  it('reveals full key when reveal button is clicked', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc', apiKey: 'thk_full_key_123' });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Reveal API key"]')).not.toBeNull();
    });
    fireEvent.click(container.querySelector('[aria-label="Reveal API key"]')!);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('thk_full_key_123');
    });
  });

  it('hides full key when hide button is clicked', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc', apiKey: 'thk_full_key_123' });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Reveal API key"]')).not.toBeNull();
    });
    fireEvent.click(container.querySelector('[aria-label="Reveal API key"]')!);
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Hide API key"]')).not.toBeNull();
    });
    fireEvent.click(container.querySelector('[aria-label="Hide API key"]')!);
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('thk_full_key_123');
    });
  });

  it('opens delete modal on Delete harness click', () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    expect(document.body.textContent).toContain('Delete test-agent');
  });

  it('has rotate key button', () => {
    const { container } = render(() => <Settings />);
    const rotateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Rotate key'),
    );
    expect(rotateBtn).not.toBeUndefined();
  });

  it('save button is disabled when agent name unchanged', () => {
    const { container } = render(() => <Settings />);
    const saveBtns = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Save',
    );
    const saveBtn = saveBtns[0] as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('save button enables when agent name changes', () => {
    render(() => <Settings />);
    const input = screen.getByLabelText('Harness name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'new-name' } });
    const saveBtn = screen.getByText('Save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it('clicking Save calls renameAgent API then reloads', async () => {
    const replaceFn = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, replace: replaceFn },
      writable: true,
      configurable: true,
    });
    render(() => <Settings />);
    fireEvent.change(screen.getByLabelText('Harness name'), { target: { value: 'new-name' } });
    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => {
      expect(mockRenameAgent).toHaveBeenCalledWith('test-agent', 'new-name');
    });
    await vi.waitFor(() => {
      expect(replaceFn).toHaveBeenCalledWith('/harnesses/new-name/settings');
    });
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('resets name on rename error', async () => {
    mockRenameAgent.mockRejectedValueOnce(new Error('Conflict'));
    render(() => <Settings />);
    const input = screen.getByLabelText('Harness name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bad-name' } });
    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => {
      expect(input.value).toBe('test-agent');
    });
  });

  it('clicking Rotate key calls rotateAgentKey', async () => {
    mockRotateAgentKey.mockResolvedValue({ apiKey: 'thk_new_rotated_key' });
    const { container } = render(() => <Settings />);
    const rotateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Rotate key'),
    )!;
    fireEvent.click(rotateBtn);
    await vi.waitFor(() => {
      expect(mockRotateAgentKey).toHaveBeenCalledWith('test-agent');
    });
  });

  it('auto-reveals key after successful rotation', async () => {
    mockRotateAgentKey.mockResolvedValue({ apiKey: 'thk_new_rotated_key' });
    const { container } = render(() => <Settings />);
    const rotateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Rotate key'),
    )!;
    fireEvent.click(rotateBtn);
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Hide API key"]')).not.toBeNull();
      expect(container.textContent).toContain('thk_new_rotated_key');
    });
  });

  it('closes delete modal on Escape key', () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    fireEvent.keyDown(document.querySelector('.overlay')!, { key: 'Escape' });
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('delete button is disabled until name matches', () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    const deleteBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Delete this harness'),
    ) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });

  it('calls deleteAgent when confirmed', async () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    fireEvent.change(document.querySelector('.overlay input[type="text"]')!, {
      target: { value: 'test-agent' },
    });
    const deleteBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Delete this harness'),
    )!;
    fireEvent.click(deleteBtn);
    await vi.waitFor(() => {
      expect(mockDeleteAgent).toHaveBeenCalledWith('test-agent');
    });
  });

  it('shows setup instructions with platform from agent info', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const el = container.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-platform')).toBe('openclaw');
    });
  });

  it('shows settings description without duplicating the agent heading', () => {
    const { container } = render(() => <Settings />);
    expect(container.textContent).toContain('Rename your agent');
  });

  it('handles rotate key error gracefully', async () => {
    mockRotateAgentKey.mockRejectedValue(new Error('Rotate failed'));
    const { container } = render(() => <Settings />);
    const rotateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Rotate key'),
    )!;
    fireEvent.click(rotateBtn);
    await vi.waitFor(() => {
      expect(mockRotateAgentKey).toHaveBeenCalled();
    });
  });

  it('handles delete agent error gracefully', async () => {
    mockDeleteAgent.mockRejectedValue(new Error('Delete failed'));
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    fireEvent.change(document.querySelector('.overlay input[type="text"]')!, {
      target: { value: 'test-agent' },
    });
    const deleteBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Delete this harness'),
    )!;
    fireEvent.click(deleteBtn);
    await vi.waitFor(() => {
      expect(mockDeleteAgent).toHaveBeenCalled();
    });
  });

  it('shows ErrorBoundary fallback when child crashes', async () => {
    mockSetupThrows = true;
    const suppress = (e: ErrorEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('error', suppress, true);
    try {
      const { container } = render(() => <Settings />);
      await vi.waitFor(() => {
        expect(container.textContent).toContain('Something went wrong');
      });
    } finally {
      window.removeEventListener('error', suppress, true);
      mockSetupThrows = false;
    }
  });

  it('calls updateAgent when type changed via modal Save', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    // Open the type modal
    const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Change'),
    )!;
    fireEvent.click(changeBtn);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
    // Change category via mock picker
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    fireEvent.click(document.querySelector('[data-testid="pick-platform"]')!);
    // Click the Save button inside the modal
    const modalSaveBtn = Array.from(
      document.querySelectorAll('[role="dialog"] .actions button'),
    ).find((b) => b.textContent?.includes('Save')) as HTMLButtonElement;
    expect(modalSaveBtn).not.toBeUndefined();
    fireEvent.click(modalSaveBtn);
    await vi.waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith(
        'test-agent',
        expect.objectContaining({ agent_category: 'app' }),
      );
    });
  });

  it('opens setup modal after type changed via modal save', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      )!,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    fireEvent.click(document.querySelector('[data-testid="pick-platform"]')!);
    const modalSaveBtn = Array.from(
      document.querySelectorAll('[role="dialog"] .actions button'),
    ).find((b) => b.textContent?.includes('Save'))!;
    fireEvent.click(modalSaveBtn);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Set up harness');
    });
  });

  it('shows current type display with platform label', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('OpenClaw');
      expect(container.textContent).toContain('AI agent');
    });
  });

  it('closes delete modal when clicking overlay', () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    const overlay = document.querySelector('.overlay')!;
    // Press on the overlay itself (not the modal card inside); the shared Modal
    // closes on a backdrop mousedown.
    fireEvent.mouseDown(overlay);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('closes delete modal when clicking close button', () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    const closeBtn = document.querySelector('.overlay [aria-label="Close"]');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('opens type modal when Change button clicked', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      )!,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
  });

  it('passes keyPrefix to setup component', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_xyz_prefix' });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const el = container.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-key-prefix')).toBe('thk_xyz_prefix');
    });
  });

  it('disables AgentTypePicker during save in modal', async () => {
    let resolveSave: (v: any) => void;
    mockUpdateAgent.mockReturnValue(
      new Promise((r) => {
        resolveSave = r;
      }),
    );
    const { container } = render(() => <Settings />);
    // Open type modal
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      )!,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
    // Change type
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    fireEvent.click(document.querySelector('[data-testid="pick-platform"]')!);
    // Click save in modal
    const modalSaveBtn = Array.from(
      document.querySelectorAll('[role="dialog"] .actions button'),
    ).find((b) => b.textContent?.includes('Save'))!;
    fireEvent.click(modalSaveBtn);
    // Verify save button shows spinner and picker is disabled
    await vi.waitFor(() => {
      const spinnerBtn = Array.from(
        document.querySelectorAll('[role="dialog"] .actions button'),
      ).find((b) => b.querySelector('.spinner'));
      expect(spinnerBtn).not.toBeUndefined();
      expect(spinnerBtn!.hasAttribute('disabled')).toBe(true);
      // Verify picker disabled prop is true during save
      const picker = document.querySelector('[data-testid="agent-type-picker"]');
      expect(picker!.getAttribute('data-disabled')).toBe('true');
    });
    resolveSave!({});
  });

  it('shows error banner when API key fetch fails', async () => {
    mockGetAgentKey.mockRejectedValue(new Error('key fetch failed'));
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Could not load your API key');
    });
  });

  it('shows fallback key display when no full key available', async () => {
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_xyz' });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('thk_xyz...');
    });
  });

  it('handles updateAgent rejection in type modal save without crashing', async () => {
    mockUpdateAgent.mockRejectedValueOnce(new Error('type update failed'));
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      )!,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-testid="pick-app"]')!);
    fireEvent.click(document.querySelector('[data-testid="pick-platform"]')!);
    const modalSaveBtn = Array.from(
      document.querySelectorAll('[role="dialog"] .actions button'),
    ).find((b) => b.textContent?.includes('Save')) as HTMLButtonElement;
    fireEvent.click(modalSaveBtn);
    await vi.waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalled();
    });
    // After the rejection, the modal should still be visible (not advanced to setup modal)
    // and the Save button should be re-enabled (savingType back to false).
    await vi.waitFor(() => {
      const stillThere = document.querySelector('[role="dialog"] .actions button');
      expect(stillThere!.hasAttribute('disabled')).toBe(false);
    });
  });

  it('closes the Change type modal when Escape is pressed', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      )!,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
    // The change-type modal is the second overlay — find the one hosting the picker
    const pickerModal = document
      .querySelector('[data-testid="agent-type-picker"]')!
      .closest('.overlay') as HTMLElement;
    expect(pickerModal).not.toBeNull();
    fireEvent.keyDown(pickerModal, { key: 'Escape' });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).toBeNull();
    });
  });

  it('closes the Change type modal when clicking the overlay backdrop', async () => {
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const changeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      );
      expect(changeBtn).not.toBeUndefined();
    });
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Change'),
      )!,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).not.toBeNull();
    });
    const pickerModal = document
      .querySelector('[data-testid="agent-type-picker"]')!
      .closest('.overlay') as HTMLElement;
    fireEvent.mouseDown(pickerModal);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="agent-type-picker"]')).toBeNull();
    });
  });

  it('uses thinker.example.com in setup on the gateway host', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        hostname: 'thinker.example.com',
        origin: 'https://thinker.example.com',
      },
      writable: true,
      configurable: true,
    });
    mockGetAgentKey.mockResolvedValue({ keyPrefix: 'thk_abc' });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      const el = container.querySelector('[data-testid="setup-add-provider"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-base-url')).toBe('https://thinker.example.com/v1');
    });
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('submits delete via Enter key on confirm input', async () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    const input = document.querySelector('.overlay input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'test-agent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(mockDeleteAgent).toHaveBeenCalledWith('test-agent');
    });
  });

  it('does not delete via Enter when name does not match', async () => {
    const { container } = render(() => <Settings />);
    fireEvent.click(screen.getByText('Delete harness'));
    const input = document.querySelector('.overlay input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrong-name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockDeleteAgent).not.toHaveBeenCalled();
  });

  it('shows raw platform value when platform is not in PLATFORM_LABELS', async () => {
    mockGetAgentInfo.mockResolvedValue({
      agent_name: 'test-agent',
      agent_category: 'personal',
      agent_platform: 'custom_platform',
    });
    const { container } = render(() => <Settings />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('custom_platform');
    });
  });
});
