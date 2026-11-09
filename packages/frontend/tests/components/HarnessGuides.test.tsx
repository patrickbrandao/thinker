import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.stubGlobal('navigator', {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

import SetupStepAddProvider from '../../src/components/SetupStepAddProvider';

const props = {
  apiKey: 'thk_full_secret_value',
  keyPrefix: 'thk_full',
  baseUrl: 'http://localhost:2099/v1',
  virtualModels: ['fast'],
};

function guide(platform: string) {
  return render(<SetupStepAddProvider {...props} platform={platform} />).container;
}

describe('harness setup guides', () => {
  it('Claude Desktop: bare origin, bearer, auto and virtual models in inferenceModels', () => {
    const c = guide('claude-app');
    expect(c.textContent).toContain('Connect Claude Desktop to Thinker');
    expect(c.textContent).toContain('Gateway base URL');
    expect(c.textContent).toContain('http://localhost:2099');
    expect(c.textContent).not.toContain('"inferenceGatewayBaseUrl": "http://localhost:2099/v1"');
    expect(c.textContent).toContain('"inferenceGatewayAuthScheme": "bearer"');
    expect(c.textContent).toContain('"name": "fast"');
    expect(c.textContent).not.toContain('thk_full_secret_value');
  });

  it('Copilot CLI: providers.json with /v1 and the virtual models', () => {
    const c = guide('copilot-cli');
    expect(c.textContent).toContain('~/.copilot/providers.json');
    expect(c.textContent).toContain('"baseUrl": "http://localhost:2099/v1"');
    expect(c.textContent).toContain('"wireApi": "completions"');
    expect(c.textContent).toContain('"id": "fast"');
    expect(c.textContent).toContain('maxPromptTokens');
  });

  it('Agent Pi: models.json with session affinity, copying the real key', () => {
    const writeText = vi.mocked(navigator.clipboard.writeText);
    writeText.mockClear();
    const c = guide('pi');
    expect(c.textContent).toContain('~/.pi/agent/models.json');
    expect(c.textContent).toContain('"sendSessionAffinityHeaders": true');
    expect(c.textContent).toContain('"contextWindow": 128000');
    expect(c.textContent).toContain('thk_full...');
    fireEvent.click(c.querySelector('.setup-cli-block button[aria-label*="Copy" i]')!);
    expect(writeText.mock.calls[0]![0]).toContain('"apiKey": "thk_full_secret_value"');
  });

  it('DeepSeek Harness: native route without /v1, Custom model API with /v1', () => {
    const c = guide('deepseek-harness');
    expect(c.textContent).toContain('baseURL: http://localhost:2099\n');
    expect(c.textContent).toContain('export THINKER_AGENT_KEY=');
    fireEvent.click(Array.from(c.querySelectorAll('[role="tab"]')).at(-1)!);
    expect(c.textContent).toContain('baseURL: http://localhost:2099/v1');
    expect(c.textContent).toContain('api: openai-completions');
  });

  it('Open WebUI: URL with /v1 and the chat id session header', () => {
    const c = guide('open-webui');
    expect(c.textContent).toContain('http://localhost:2099/v1');
    expect(c.textContent).toContain('{"x-session-key": "{{CHAT_ID}}"}');
    expect(c.textContent).toContain('host.docker.internal');
  });

  it('Chatwoot: endpoint without /v1', () => {
    const c = guide('chatwoot');
    const endpoint = Array.from(c.querySelectorAll('.setup-onboard-fields__row')).find((row) =>
      row.textContent?.includes('OpenAI API Endpoint'),
    );
    expect(endpoint?.querySelector('code')?.textContent).toBe('http://localhost:2099');
  });

  it('Langflow: allows the Thinker host past the SSRF guard', () => {
    const c = guide('langflow');
    expect(c.textContent).toContain('LANGFLOW_SSRF_ALLOWED_HOSTS=localhost');
    expect(c.textContent).toContain('OpenAI Compatible');
  });

  it('Zapier: Custom Request to chat/completions without stream', () => {
    const c = guide('zapier');
    expect(c.textContent).toContain('http://localhost:2099/v1/chat/completions');
    expect(c.textContent).toContain('Bearer thk_full...');
    expect(c.textContent).toContain('"model": "auto"');
    expect(c.textContent).toContain('30 seconds');
  });

  it('n8n: explains the Use Responses API toggle', () => {
    const c = guide('n8n');
    expect(c.textContent).toContain('Use Responses API');
    expect(c.textContent).toContain('/v1/responses');
  });

  it('Codex and OpenClaw declare the context window; OpenClaw lists virtual models', () => {
    expect(guide('codex').textContent).toContain('model_context_window = 128000');
    const openclaw = guide('openclaw').textContent!;
    expect(openclaw).toContain('"supportsUsageInStreaming":true');
    expect(openclaw).toContain('"id":"fast"');
  });

  it('Craft: warns about the custom-endpoint defaults', () => {
    const c = guide('craft');
    expect(c.textContent).toContain('131072');
    expect(c.textContent).toContain('~/.craft-agent/config.json');
    expect(c.textContent).toContain('"supportsImages": true');
  });
});
