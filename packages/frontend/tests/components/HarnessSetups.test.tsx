import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { OPEN_WEBUI_SESSION_HEADERS } from 'thinker-shared';
import OpenWebUISetup from '../../src/components/OpenWebUISetup';
import DeepSeekHarnessSetup from '../../src/components/DeepSeekHarnessSetup';
import CopilotCliSetup from '../../src/components/CopilotCliSetup';
import ChatwootSetup from '../../src/components/ChatwootSetup';
import PiSetup from '../../src/components/PiSetup';
import LangflowSetup from '../../src/components/LangflowSetup';
import N8nSetup from '../../src/components/N8nSetup';
import { resetLocaleForTests } from '../../src/i18n';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const base = {
  apiKey: null as string | null,
  keyPrefix: null as string | null,
  baseUrl: 'http://localhost:2099/v1',
};

/** Value cell of the onboarding row labelled `label`. */
function fieldValue(label: string): HTMLElement {
  const row = screen.getAllByRole('listitem').find((r) => within(r).queryByText(label));
  if (!row) throw new Error(`no row ${label}`);
  return row;
}

describe('OpenWebUISetup', () => {
  it('lists URL, API key and headers with the key placeholder', () => {
    render(<OpenWebUISetup {...base} />);
    expect(fieldValue('URL').textContent).toContain('http://localhost:2099/v1');
    expect(fieldValue('API Key').textContent).toContain('thk_YOUR_KEY');
    expect(fieldValue('Headers').textContent).toContain(OPEN_WEBUI_SESSION_HEADERS);
  });

  it('mentions the Docker host and session header guidance', () => {
    const { container } = render(<OpenWebUISetup {...base} />);
    const text = container.textContent ?? '';
    expect(text).toContain('host.docker.internal');
    expect(text).toContain('x-session-key');
    expect(text).toContain('X-OpenWebUI-Chat-Id');
    expect(text).toContain('TASK_MODEL');
  });

  it('copies the base URL and, once revealed, the real key', async () => {
    render(<OpenWebUISetup {...base} apiKey="thk_real_key" keyPrefix="thk_re" />);
    expect(fieldValue('API Key').textContent).toContain('thk_re...');
    expect(fieldValue('API Key').textContent).not.toContain('thk_real_key');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
    expect(fieldValue('API Key').textContent).toContain('thk_real_key');
    await act(async () => {
      fireEvent.click(within(fieldValue('API Key')).getByRole('button', { name: /Copy/ }));
    });
    expect(writeText).toHaveBeenCalledWith('thk_real_key');
    await act(async () => {
      fireEvent.click(within(fieldValue('URL')).getByRole('button', { name: /Copy/ }));
    });
    expect(writeText).toHaveBeenCalledWith('http://localhost:2099/v1');
  });
});

describe('DeepSeekHarnessSetup', () => {
  it('starts on the native route: base URL without /v1 and the key export', () => {
    const { container } = render(<DeepSeekHarnessSetup {...base} keyPrefix="thk_pp" />);
    const pre = container.querySelectorAll('pre');
    expect(pre).toHaveLength(2);
    expect(pre[0].textContent).toContain('baseURL: http://localhost:2099');
    expect(pre[0].textContent).not.toContain('http://localhost:2099/v1');
    expect(pre[0].textContent).toContain('apiKeyEnv: THINKER_API_KEY');
    expect(pre[1].textContent).toBe('export THINKER_API_KEY="thk_pp..."');
    expect(screen.getByRole('tab', { name: 'Native route' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('switches to the Custom model API route, which keeps /v1', () => {
    const { container } = render(<DeepSeekHarnessSetup {...base} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Custom model API' }));
    const first = container.querySelector('pre')!.textContent!;
    expect(first).toContain('llm-pi-ai');
    expect(first).toContain('baseURL: http://localhost:2099/v1');
    expect(
      screen.getByRole('tab', { name: 'Custom model API' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('declares virtual models after auto in the snippet', () => {
    const { container } = render(
      <DeepSeekHarnessSetup {...base} virtualModels={['fast-model', 'deep-model']} />,
    );
    const yaml = container.querySelector('pre')!.textContent!;
    expect(yaml.indexOf('auto')).toBeGreaterThan(-1);
    expect(yaml.indexOf('fast-model')).toBeGreaterThan(yaml.indexOf('auto'));
    expect(yaml.indexOf('deep-model')).toBeGreaterThan(yaml.indexOf('fast-model'));
  });

  it('shows the real key only after reveal, and always copies the real key', async () => {
    const { container } = render(
      <DeepSeekHarnessSetup {...base} apiKey="thk_real" keyPrefix="thk_re" />,
    );
    const exportPre = () => container.querySelectorAll('pre')[1].textContent;
    expect(exportPre()).toBe('export THINKER_API_KEY="thk_re..."');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
    expect(exportPre()).toBe('export THINKER_API_KEY="thk_real"');
    fireEvent.click(screen.getByRole('button', { name: 'Hide API key' }));
    const copyButtons = screen.getAllByRole('button', { name: 'Copy to clipboard' });
    await act(async () => {
      fireEvent.click(copyButtons[1]);
    });
    expect(writeText).toHaveBeenCalledWith('export THINKER_API_KEY="thk_real"');
  });

  it('has no reveal toggle when only a prefix is known', () => {
    render(<DeepSeekHarnessSetup {...base} keyPrefix="thk_re" />);
    expect(screen.queryByRole('button', { name: 'Reveal API key' })).toBeNull();
  });
});

describe('CopilotCliSetup', () => {
  it('renders providers.json with the base URL, placeholder key and thinker/auto', () => {
    const { container } = render(<CopilotCliSetup {...base} />);
    const json = JSON.parse(container.querySelector('pre')!.textContent!);
    expect(json.providers[0]).toMatchObject({
      name: 'thinker',
      baseUrl: 'http://localhost:2099/v1',
      apiKey: 'thk_YOUR_KEY',
    });
    expect(json.models[0].id).toBe('auto');
    expect(container.textContent).toContain('~/.copilot/providers.json');
    expect(container.textContent).toContain('copilot --model thinker/auto');
    expect(container.textContent).toContain('maxPromptTokens');
  });

  it('includes virtual models and reveals the key', () => {
    const { container } = render(
      <CopilotCliSetup {...base} apiKey="thk_real" keyPrefix="thk_re" virtualModels={['coder']} />,
    );
    const json = () => JSON.parse(container.querySelector('pre')!.textContent!);
    expect(json().models.map((m: { id: string }) => m.id)).toEqual(['auto', 'coder']);
    expect(json().providers[0].apiKey).toBe('thk_re...');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
    expect(json().providers[0].apiKey).toBe('thk_real');
  });
});

describe('ChatwootSetup', () => {
  it('strips /v1 from the endpoint, since Chatwoot appends it', () => {
    render(<ChatwootSetup {...base} />);
    expect(fieldValue('OpenAI API Endpoint').textContent).toContain('http://localhost:2099');
    expect(fieldValue('OpenAI API Endpoint').textContent).not.toContain('/v1');
    expect(fieldValue('OpenAI Model').textContent).toContain('auto');
    expect(fieldValue('OpenAI API Key').textContent).toContain('thk_YOUR_KEY');
  });

  it('also strips a trailing slash after /v1 and leaves other URLs alone', () => {
    const { unmount } = render(<ChatwootSetup {...base} baseUrl="https://t.example.com/v1/" />);
    expect(fieldValue('OpenAI API Endpoint').textContent).toContain('https://t.example.com');
    expect(fieldValue('OpenAI API Endpoint').textContent).not.toContain('/v1');
    unmount();
    render(<ChatwootSetup {...base} baseUrl="https://t.example.com/api" />);
    expect(fieldValue('OpenAI API Endpoint').textContent).toContain('https://t.example.com/api');
  });

  it('warns about the /v1/v1 failure mode', () => {
    const { container } = render(<ChatwootSetup {...base} />);
    expect(container.textContent).toContain('/v1/v1');
  });
});

describe('PiSetup', () => {
  it('renders models.json for Thinker with the session-affinity compat flag', () => {
    const { container } = render(
      <PiSetup {...base} keyPrefix="thk_pp" virtualModels={['coder']} />,
    );
    const json = JSON.parse(container.querySelector('pre')!.textContent!);
    const p = json.providers.thinker;
    expect(p.baseUrl).toBe('http://localhost:2099/v1');
    expect(p.apiKey).toBe('thk_pp...');
    expect(p.api).toBe('openai-completions');
    expect(p.compat.sendSessionAffinityHeaders).toBe(true);
    expect(p.models.map((m: { id: string }) => m.id)).toEqual(['auto', 'coder']);
    expect(container.textContent).toContain('~/.pi/agent/models.json');
    expect(container.textContent).toContain('contextWindow');
    expect(container.textContent).toContain('reasoning_effort');
  });

  it('copies the real key', async () => {
    render(<PiSetup {...base} apiKey="thk_real" keyPrefix="thk_re" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    });
    expect(JSON.parse(writeText.mock.calls[0][0]).providers.thinker.apiKey).toBe('thk_real');
  });
});

describe('LangflowSetup', () => {
  it('derives the SSRF allowlist host from the base URL', () => {
    const { container } = render(<LangflowSetup {...base} baseUrl="http://10.0.0.5:2099/v1" />);
    expect(container.querySelector('pre')!.textContent).toBe(
      'LANGFLOW_SSRF_ALLOWED_HOSTS=10.0.0.5',
    );
    expect(fieldValue('Base URL').textContent).toContain('http://10.0.0.5:2099/v1');
  });

  it('strips brackets from IPv6 hosts', () => {
    const { container } = render(<LangflowSetup {...base} baseUrl="http://[::1]:2099/v1" />);
    expect(container.querySelector('pre')!.textContent).toBe('LANGFLOW_SSRF_ALLOWED_HOSTS=::1');
  });

  it('falls back to a placeholder when the base URL is not a URL', () => {
    const { container } = render(<LangflowSetup {...base} baseUrl="not a url" />);
    expect(container.querySelector('pre')!.textContent).toBe(
      'LANGFLOW_SSRF_ALLOWED_HOSTS=<thinker-host>',
    );
  });

  it('shows the key row and the Docker hint', () => {
    const { container } = render(<LangflowSetup {...base} keyPrefix="thk_pp" />);
    expect(fieldValue('API Key').textContent).toContain('thk_pp...');
    expect(container.textContent).toContain('host.docker.internal');
  });
});

describe('N8nSetup', () => {
  it('lists base URL, key and the auto model', () => {
    render(<N8nSetup {...base} />);
    expect(fieldValue('Base URL').textContent).toContain('http://localhost:2099/v1');
    expect(fieldValue('API Key').textContent).toContain('thk_YOUR_KEY');
    expect(fieldValue('Model').textContent).toContain('auto');
    expect(screen.getByRole('list', { name: 'n8n credential values' })).toBeTruthy();
  });

  it('links to the n8n credential docs in a new tab, safely', () => {
    render(<N8nSetup {...base} />);
    const link = screen.getByRole('link', { name: 'n8n OpenAI credential docs' });
    expect(link.getAttribute('href')).toBe(
      'https://docs.n8n.io/integrations/builtin/credentials/openai/',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('explains the Responses API toggle', () => {
    const { container } = render(<N8nSetup {...base} />);
    expect(container.textContent).toContain('Use Responses API');
    expect(container.textContent).toContain('/v1/responses');
  });

  it('reveals and copies the full key', async () => {
    render(<N8nSetup {...base} apiKey="thk_real" keyPrefix="thk_re" />);
    expect(fieldValue('API Key').textContent).toContain('thk_re...');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
    expect(fieldValue('API Key').textContent).toContain('thk_real');
    await act(async () => {
      fireEvent.click(within(fieldValue('API Key')).getByRole('button', { name: /Copy/ }));
    });
    expect(writeText).toHaveBeenCalledWith('thk_real');
  });

  it('shows no reveal toggle without a full key', () => {
    render(<N8nSetup {...base} keyPrefix="thk_re" />);
    expect(screen.queryByRole('button', { name: 'Reveal API key' })).toBeNull();
  });
});

describe('Setup guides in pt-BR', () => {
  beforeEach(() => resetLocaleForTests('pt-BR'));

  it('translates the prose but keeps URL, key placeholder and snippets literal', () => {
    const { container } = render(<ChatwootSetup {...base} />);
    expect(container.textContent).toContain('No Chatwoot, abra Super Admin');
    expect(container.textContent).toContain('http://localhost:2099');
    expect(container.textContent).toContain('thk_YOUR_KEY');
    expect(container.textContent).not.toContain('In Chatwoot, open');
    expect(screen.getByRole('list', { name: 'Valores para preencher' })).toBeTruthy();
  });

  it('translates Pi and Copilot CLI hints', () => {
    const { container, unmount } = render(<PiSetup {...base} />);
    expect(container.textContent).toContain('Salve isto em ~/.pi/agent/models.json');
    unmount();
    const copilot = render(<CopilotCliSetup {...base} />);
    expect(copilot.container.textContent).toContain('Salve isto em ~/.copilot/providers.json');
    expect(copilot.container.querySelector('pre')!.textContent).toContain('"maxPromptTokens"');
  });

  it('translates the DeepSeek Harness tabs and Open WebUI/n8n/Langflow guides', () => {
    const ds = render(<DeepSeekHarnessSetup {...base} />);
    expect(screen.getByRole('tab', { name: 'Rota nativa' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Método de configuração' })).toBeTruthy();
    ds.unmount();
    const ow = render(<OpenWebUISetup {...base} />);
    expect(ow.container.textContent).toContain('No Open WebUI, abra Admin Settings');
    ow.unmount();
    const n8n = render(<N8nSetup {...base} />);
    expect(n8n.container.textContent).toContain('No n8n, adicione o node nativo');
    expect(
      screen.getByRole('link', { name: 'documentação da credencial OpenAI do n8n' }),
    ).toBeTruthy();
    n8n.unmount();
    const lf = render(<LangflowSetup {...base} />);
    expect(lf.container.textContent).toContain('O Langflow bloqueia hosts privados');
    expect(lf.container.querySelector('pre')!.textContent).toBe(
      'LANGFLOW_SSRF_ALLOWED_HOSTS=localhost',
    );
  });
});
