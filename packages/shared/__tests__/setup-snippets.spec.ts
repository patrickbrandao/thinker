import {
  getClaudeCodeSettingsSnippet,
  getCodexConfigSnippet,
  getCodexKeyExportSnippet,
  getNanobotConfigSnippet,
  getOpenClawSnippet,
  getClaudeAppConfigSnippet,
  getCopilotCliProvidersSnippet,
  getDeepSeekHarnessNativeSnippet,
  getDeepSeekHarnessPiAiSnippet,
  getPiModelsSnippet,
  OPEN_WEBUI_SESSION_HEADERS,
  PLATFORM_SETUP_SNIPPETS,
  SNIPPET_CONTEXT_WINDOW,
} from '../src/setup-snippets';

describe('setup snippets', () => {
  const URL = 'https://app.thinker.example.com/v1';
  const KEY = 'thk_test_key';

  it('openclaw snippet wires the provider and restarts the gateway', () => {
    const s = getOpenClawSnippet(URL, KEY);
    expect(s).toContain('models.providers.thinker');
    expect(s).toContain('agents.defaults.model.primary thinker/auto');
    expect(s).toContain(URL);
    expect(s).toContain(KEY);
    expect(s).toContain('openclaw gateway restart');
  });

  it('claude-code snippet strips /v1 (SDK appends /v1/messages itself)', () => {
    const s = getClaudeCodeSettingsSnippet(URL, KEY);
    expect(s).toContain('"ANTHROPIC_BASE_URL": "https://app.thinker.example.com"');
    expect(s).toContain(KEY);
    const noV1 = getClaudeCodeSettingsSnippet('https://x.test', KEY);
    expect(noV1).toContain('"ANTHROPIC_BASE_URL": "https://x.test"');
  });

  it('nanobot snippet uses the custom provider slot', () => {
    const s = getNanobotConfigSnippet(URL, KEY);
    expect(s).toContain('"provider": "custom"');
    expect(s).toContain(URL);
    expect(s).toContain(KEY);
  });

  it('codex config pins the Responses wire API and the key export is shell-safe', () => {
    const config = getCodexConfigSnippet(URL);
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain(`base_url = "${URL}"`);
    expect(config).toContain('model_provider = "thinker"');
    expect(config).toContain('[model_providers.thinker]');
    expect(config).toContain('env_key = "THINKER_AGENT_KEY"');
    expect(getCodexKeyExportSnippet(KEY)).toBe(`export THINKER_AGENT_KEY="${KEY}"`);
  });

  it('codex config declares the context window before the provider table', () => {
    const config = getCodexConfigSnippet(URL);
    expect(config).toContain(`model_context_window = ${SNIPPET_CONTEXT_WINDOW}`);
    expect(config.indexOf('model_context_window')).toBeLessThan(
      config.indexOf('[model_providers.thinker]'),
    );
  });

  it('openclaw declares images, context and streaming usage for auto and virtual models', () => {
    const s = getOpenClawSnippet(URL, KEY, ['fast']);
    const json = JSON.parse(/'(.*)'/.exec(s)![1]!);
    expect(json.models.map((m: { id: string }) => m.id)).toEqual(['auto', 'fast']);
    expect(json.models[0]).toMatchObject({
      input: ['text', 'image'],
      contextWindow: SNIPPET_CONTEXT_WINDOW,
      compat: { supportsUsageInStreaming: true },
    });
  });

  it('copilot cli providers.json keeps /v1, Chat Completions and explicit limits', () => {
    const json = JSON.parse(getCopilotCliProvidersSnippet(URL, KEY, ['fast']));
    expect(json.providers[0]).toEqual({
      name: 'thinker',
      type: 'openai',
      baseUrl: URL,
      apiKey: KEY,
      wireApi: 'completions',
    });
    expect(json.models.map((m: { id: string }) => m.id)).toEqual(['auto', 'fast']);
    expect(json.models[0].maxPromptTokens).toBe(SNIPPET_CONTEXT_WINDOW);
  });

  it('pi models.json sends session affinity and declares model metadata', () => {
    const json = JSON.parse(getPiModelsSnippet(URL, KEY));
    const thinker = json.providers.thinker;
    expect(thinker).toMatchObject({ baseUrl: URL, api: 'openai-completions', apiKey: KEY });
    expect(thinker.compat).toEqual({ sendSessionAffinityHeaders: true });
    expect(thinker.models[0]).toMatchObject({
      id: 'auto',
      contextWindow: SNIPPET_CONTEXT_WINDOW,
      input: ['text', 'image'],
    });
  });

  it('deepseek harness: native route drops /v1, pi-ai route keeps it', () => {
    expect(getDeepSeekHarnessNativeSnippet(URL)).toContain(
      'baseURL: https://app.thinker.example.com\n',
    );
    expect(getDeepSeekHarnessNativeSnippet(URL, ['fast'])).toContain('- id: "fast"');
    expect(getDeepSeekHarnessPiAiSnippet(URL)).toContain(`baseURL: ${URL}\n`);
    expect(getDeepSeekHarnessPiAiSnippet(URL)).toContain('api: openai-completions');
  });

  it('claude desktop uses the bare origin and declares auto in inferenceModels', () => {
    const json = JSON.parse(getClaudeAppConfigSnippet(URL, KEY, ['fast']));
    expect(json.inferenceGatewayBaseUrl).toBe('https://app.thinker.example.com');
    expect(json.inferenceGatewayAuthScheme).toBe('bearer');
    expect(json.inferenceModels.map((m: { name: string }) => m.name)).toEqual(['auto', 'fast']);
  });

  it('chatwoot drops /v1, langflow names the host to allow, zapier posts without stream', () => {
    const chatwoot = PLATFORM_SETUP_SNIPPETS['chatwoot']!(URL, KEY);
    expect(chatwoot).toContain('OpenAI API Endpoint: https://app.thinker.example.com\n');
    const langflow = PLATFORM_SETUP_SNIPPETS['langflow']!(URL, KEY);
    expect(langflow).toContain('LANGFLOW_SSRF_ALLOWED_HOSTS=app.thinker.example.com\n');
    expect(PLATFORM_SETUP_SNIPPETS['langflow']!('{{ORIGIN}}/v1', KEY)).toContain(
      'LANGFLOW_SSRF_ALLOWED_HOSTS=<thinker-host>',
    );
    const zapier = PLATFORM_SETUP_SNIPPETS['zapier']!(URL, KEY);
    expect(zapier).toContain(`${URL}/chat/completions`);
    expect(zapier).toContain(`Bearer ${KEY}`);
  });

  it('open webui keeps /v1 and sends the chat id as the session', () => {
    const s = PLATFORM_SETUP_SNIPPETS['open-webui']!(URL, KEY);
    expect(s).toContain(`OPENAI_API_BASE_URL=${URL}`);
    expect(s).toContain(OPEN_WEBUI_SESSION_HEADERS);
    expect(OPEN_WEBUI_SESSION_HEADERS).toBe('{"x-session-key": "{{CHAT_ID}}"}');
  });

  it('n8n guidance covers the Responses API toggle', () => {
    expect(PLATFORM_SETUP_SNIPPETS['n8n']!('u/v1', 'k')).toContain('Use Responses API');
  });

  it('registry maps platforms to their renderers', () => {
    expect(PLATFORM_SETUP_SNIPPETS['openclaw']('u', 'k')).toContain('openclaw');
    expect(PLATFORM_SETUP_SNIPPETS['codex']('u/v1', 'k')).toContain('wire_api = "responses"');
    expect(PLATFORM_SETUP_SNIPPETS['n8n']('u/v1', 'k')).toContain('Base URL: u/v1');
    expect(PLATFORM_SETUP_SNIPPETS['n8n']('u/v1', 'k')).toContain('OpenAI Chat Model');
    expect(Object.keys(PLATFORM_SETUP_SNIPPETS).sort()).toEqual([
      'chatwoot',
      'claude-app',
      'claude-code',
      'codex',
      'copilot-cli',
      'deepseek-harness',
      'langflow',
      'n8n',
      'nanobot',
      'open-webui',
      'openclaw',
      'pi',
      'zapier',
    ]);
  });
});
