import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';

vi.stubGlobal('navigator', {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

const mockList = vi.fn();
let listImpl: ((name: unknown) => Promise<unknown>) | null = null;
vi.mock('../../src/services/api/virtual-models.js', () => ({
  listVirtualModels: (name: unknown) => (listImpl ? listImpl(name) : mockList(name)),
}));
const mockGetAgentKey = vi.fn();
vi.mock('../../src/services/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/api.js')>()),
  getAgentKey: (...a: unknown[]) => mockGetAgentKey(...a),
}));

import VirtualModelsHint, {
  createActiveVirtualModelNames,
} from '../../src/components/VirtualModelsHint';
import SetupStepAddProvider from '../../src/components/SetupStepAddProvider';
import FrameworkSnippets from '../../src/components/FrameworkSnippets';
import VirtualModelSnippetModal from '../../src/components/VirtualModelSnippetModal';
import { getSnippetForToolkit, withSnippetModel } from '../../src/services/framework-snippets';
import type { VirtualModel } from '../../src/services/api/virtual-models';

const base = { apiKey: null, keyPrefix: null, baseUrl: 'http://localhost:2099/v1' };

describe('withSnippetModel', () => {
  it('swaps the auto model in every toolkit snippet', () => {
    for (const id of [
      'openai-sdk',
      'anthropic-sdk',
      'vercel-ai-sdk',
      'langchain',
      'curl',
    ] as const) {
      for (const lang of ['python', 'typescript'] as const) {
        const code = getSnippetForToolkit(
          id,
          'u',
          'k',
          lang,
          undefined,
          'responses',
          'deepseek/flash',
        ).code;
        expect(code).toContain('"deepseek/flash"');
        expect(code).not.toContain('"auto"');
      }
    }
    const chat = getSnippetForToolkit(
      'openai-sdk',
      'u',
      'k',
      'python',
      undefined,
      'chat-completions',
      'x',
    );
    expect(chat.code).toContain('"x"');
  });

  it('leaves auto alone', () => {
    const snippet = { code: 'model="auto"', lang: 'python' } as never;
    expect(withSnippetModel(snippet, 'auto')).toBe(snippet);
  });
});

describe('FrameworkSnippets model', () => {
  beforeEach(() => localStorage.clear());

  it('uses a fixed model in the code and the Model field', () => {
    const { container } = render(() => <FrameworkSnippets {...base} model="deepseek/flash" />);
    expect(container.querySelector('code.hljs')!.textContent).toContain('deepseek/flash');
    expect(screen.queryByRole('radiogroup', { name: 'Model' })).toBeNull();
  });

  it('offers auto and the virtual models to pick from', () => {
    const { container } = render(() => (
      <FrameworkSnippets {...base} modelOptions={['deepseek/flash', 'cheap']} />
    ));
    const group = screen.getByRole('radiogroup', { name: 'Model' });
    expect(group.textContent).toBe('autodeepseek/flashcheap');
    expect(container.querySelector('code.hljs')!.textContent).toContain('auto');
    fireEvent.click(screen.getByRole('radio', { name: 'cheap' }));
    expect(container.querySelector('code.hljs')!.textContent).toContain('"cheap"');
    expect(screen.getByRole('radio', { name: 'cheap' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('VirtualModelsHint', () => {
  it('renders nothing without virtual models', () => {
    render(() => <VirtualModelsHint names={[]} platform="claude-code" />);
    expect(screen.queryByTestId('virtual-models-hint')).toBeNull();
  });

  it.each([
    ['claude-code', '/model fast'],
    ['codex', 'codex -m fast'],
    ['opencode', 'thinker/fast'],
    ['hermes', '/v1/models'],
    ['openclaw', 'thinker/fast'],
    ['nanobot', 'agents.defaults.model'],
    ['n8n', '/v1/models'],
    ['toolkits', 'Pick one above'],
    ['craft', 'model name instead of'],
  ])('explains how %s picks one', (platform, text) => {
    render(() => <VirtualModelsHint names={['fast', 'cheap']} platform={platform} />);
    const hint = screen.getByTestId('virtual-models-hint');
    expect(hint.textContent).toContain('fast');
    expect(hint.textContent).toContain('cheap');
    expect(hint.textContent).toContain(text);
  });
});

describe('createActiveVirtualModelNames', () => {
  beforeEach(() => {
    mockList.mockClear();
    listImpl = null;
  });

  it('returns the active names in order', async () => {
    mockList.mockResolvedValue([
      { name: 'a', enabled: true },
      { name: 'b', enabled: false },
      { name: 'c', enabled: true },
    ]);
    let names!: () => string[];
    render(() => {
      names = createActiveVirtualModelNames(() => 'demo');
      return <span>{names().join(',')}</span>;
    });
    await waitFor(() => expect(names()).toEqual(['a', 'c']));
    expect(mockList).toHaveBeenCalledWith('demo');
  });

  it('returns nothing when the list fails to load', async () => {
    // A plain function, not the spy: a vitest spy that returns a rejected
    // promise reports it as an unhandled error even when the caller catches it.
    const calls: unknown[] = [];
    listImpl = (name) => {
      calls.push(name);
      return Promise.reject(new Error('offline'));
    };
    let failed!: () => string[];
    render(() => {
      failed = createActiveVirtualModelNames(() => 'other');
      return <span>{failed().length}</span>;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['other']);
    expect(failed()).toEqual([]);
  });

  it('does not load without an agent', () => {
    let none!: () => string[];
    render(() => {
      none = createActiveVirtualModelNames(() => null);
      return null;
    });
    expect(none()).toEqual([]);
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe('SetupStepAddProvider with virtual models', () => {
  beforeEach(() => localStorage.clear());

  it('lists them under a filtered harness setup', () => {
    render(() => (
      <SetupStepAddProvider {...base} platform="claude-code" virtualModels={['deepseek/flash']} />
    ));
    const hint = screen.getByTestId('virtual-models-hint');
    expect(hint.textContent).toContain('deepseek/flash');
    expect(hint.textContent).toContain('/model deepseek/flash');
  });

  it('offers them in toolkit snippets', () => {
    render(() => <SetupStepAddProvider {...base} platform="curl" virtualModels={['cheap']} />);
    expect(screen.getByRole('radio', { name: 'cheap' })).toBeTruthy();
    expect(screen.getByTestId('virtual-models-hint').textContent).toContain('Pick one above');
  });

  it('follows the selected agent tab and the toolkits tab', () => {
    render(() => <SetupStepAddProvider {...base} virtualModels={['cheap']} />);
    expect(screen.getByTestId('virtual-models-hint').textContent).toContain('thinker/cheap');
    fireEvent.click(screen.getByRole('tab', { name: /Hermes/ }));
    expect(screen.getByTestId('virtual-models-hint').textContent).toContain('hermes model');
    fireEvent.click(screen.getByRole('tab', { name: 'Toolkits' }));
    expect(screen.getByRole('radio', { name: 'cheap' })).toBeTruthy();
  });

  it('shows nothing extra without virtual models', () => {
    render(() => <SetupStepAddProvider {...base} platform="codex" />);
    expect(screen.queryByTestId('virtual-models-hint')).toBeNull();
  });
});

describe('VirtualModelSnippetModal', () => {
  const vm: VirtualModel = {
    id: 'vm-1',
    agent_id: 'agent-1',
    name: 'deepseek/flash',
    sort_order: 0,
    enabled: false,
    override_route: null,
    fallback_routes: null,
    continue_on_default: false,
    response_mode: 'buffered',
    output_modality: 'text',
    created_at: '',
    updated_at: '',
    shadows: [],
    context_length: null,
  };

  it('shows the harness key, base URL and the model, and closes', async () => {
    mockGetAgentKey.mockResolvedValue({ apiKey: 'thk_test', keyPrefix: 'thk_te' });
    const onClose = vi.fn();
    const { container } = render(() => (
      <VirtualModelSnippetModal agentName="demo" virtualModel={vm} onClose={onClose} />
    ));
    expect(screen.getByText('Use “deepseek/flash”')).toBeTruthy();
    expect(screen.getByText(/This virtual model is inactive/)).toBeTruthy();
    await waitFor(() => expect(container.textContent).toContain('thk_test'));
    expect(mockGetAgentKey).toHaveBeenCalledWith('demo');
    expect(container.querySelector('code.hljs')!.textContent).toContain('"deepseek/flash"');
    expect(container.textContent).toContain('/v1');
    fireEvent.click(screen.getByText('Done'));
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
