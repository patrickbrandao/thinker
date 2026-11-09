/**
 * Per-platform setup snippets — the single source of truth for "how do I
 * point this platform at Thinker". Consumed by the dashboard setup panels
 * directly and by the CLI via build-time template generation (functions are
 * invoked with {{ORIGIN}} placeholders and emitted as data).
 */

/** Anthropic SDK auto-appends /v1/messages to baseURL — strip a trailing /v1. */
function stripV1Suffix(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

/**
 * Context window and output limit declared for `auto` and virtual models in
 * clients that do not read `GET /v1/models` (Codex, OpenClaw, Pi, Copilot
 * CLI, Craft, DeepSeek Harness). Conservative on purpose: the real window is
 * the smallest one among the routes behind the model, shown in the harness
 * Models tab.
 */
export const SNIPPET_CONTEXT_WINDOW = 128000;
export const SNIPPET_MAX_TOKENS = 16384;

/** `auto` first, then each virtual model name once. */
function modelIds(virtualModels: readonly string[]): string[] {
  return ['auto', ...virtualModels.filter((name) => name !== 'auto')];
}

function modelLabel(id: string): string {
  return `Thinker ${id === 'auto' ? 'Auto' : id}`;
}

/** `http://host:port/v1` -> `host`, or a placeholder for templated URLs. */
function hostOf(baseUrl: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(baseUrl);
  return match ? match[1]! : '<thinker-host>';
}

export function getOpenClawSnippet(
  baseUrl: string,
  apiKey: string,
  virtualModels: readonly string[] = [],
): string {
  // Chat Completions is the surface every provider behind Thinker serves
  // without translation. OpenClaw only attaches images when `input` lists
  // them, and assumes an unknown `openai-completions` endpoint reports no
  // usage while streaming unless `supportsUsageInStreaming` says so (then it
  // estimates the context instead of counting it).
  const providerJson = JSON.stringify({
    baseUrl,
    api: 'openai-completions',
    apiKey,
    models: modelIds(virtualModels).map((id) => ({
      id,
      name: modelLabel(id),
      input: ['text', 'image'],
      contextWindow: SNIPPET_CONTEXT_WINDOW,
      maxTokens: SNIPPET_MAX_TOKENS,
      compat: { supportsUsageInStreaming: true },
    })),
  });
  return `openclaw config set models.providers.thinker '${providerJson}'
openclaw config set agents.defaults.model.primary thinker/auto
openclaw gateway restart`;
}

/**
 * The JSON block to paste into ~/.claude/settings.json. Claude Code reads
 * `env` keys from settings.json on every startup, so this is the persistent
 * configuration path — no shell rc edits, no Node required, no command-line
 * gymnastics. Pin the default model to Thinker's `auto` route so Claude
 * Code does not send its built-in Anthropic model IDs to the gateway.
 * Anthropic SDK auto-appends /v1/messages to baseURL, so we strip a trailing
 * /v1 from the rendered URL.
 */
export function getClaudeCodeSettingsSnippet(baseUrl: string, apiKey: string): string {
  const url = stripV1Suffix(baseUrl);
  return `{
  "model": "auto",
  "env": {
    "ANTHROPIC_BASE_URL": "${url}",
    "ANTHROPIC_AUTH_TOKEN": "${apiKey}"
  }
}`;
}

/**
 * The JSON block to merge into ~/.nanobot/config.json. Nanobot only accepts its
 * predefined provider keys; "custom" is the built-in slot for arbitrary
 * OpenAI-compatible endpoints, so we use that rather than an arbitrary name.
 */
export function getNanobotConfigSnippet(baseUrl: string, apiKey: string): string {
  return `{
  "agents": {
    "defaults": {
      "provider": "custom",
      "model": "auto"
    }
  },
  "providers": {
    "custom": {
      "apiKey": "${apiKey}",
      "apiBase": "${baseUrl}"
    }
  }
}`;
}

/** The `~/.codex/config.toml` block. Codex CLI and Desktop both read this file. */
export function getCodexConfigSnippet(baseUrl: string): string {
  return `model = "auto"
model_provider = "thinker"
# Codex does not read Thinker's /v1/models: for "auto" and virtual models it
# assumes a 272K window and compacts too late on smaller routes. Set this to
# the smallest context window behind the model (harness Models tab).
model_context_window = ${SNIPPET_CONTEXT_WINDOW}

[model_providers.thinker]
name = "Thinker"
base_url = "${baseUrl}"
env_key = "THINKER_AGENT_KEY"
wire_api = "responses"`;
}

export function getCodexKeyExportSnippet(apiKey: string): string {
  return `export THINKER_AGENT_KEY="${apiKey}"`;
}

/** CLI-facing combined Codex setup (config block + key export). */
function getCodexSnippet(baseUrl: string, apiKey: string): string {
  return `# Add to ~/.codex/config.toml
${getCodexConfigSnippet(baseUrl)}

# Then, in the terminal that launches Codex:
${getCodexKeyExportSnippet(apiKey)}`;
}

/**
 * CLI-facing n8n guidance. The dashboard renders these as copyable credential
 * fields; the CLI emits the same values as a pasteable comment block.
 */
function getN8nSnippet(baseUrl: string, apiKey: string): string {
  return `# In n8n, add the built-in OpenAI Chat Model node to your AI Agent / Basic
# LLM Chain. Create an OpenAI credential with:
#   Base URL: ${baseUrl}
#   API Key:  ${apiKey}
#   Model:    auto
# n8n sends no session id: in the credential, use "Add Custom Header" with
#   Name:  x-session-key
#   Value: a name for this workflow (one credential per workflow keeps
#          each workflow's requests together).
# Node version 1.3 turns "Use Responses API" on by default and calls
# /v1/responses. Turn it off when your providers have no Responses API: the
# node then sends Chat Completions, which Thinker forwards without
# translation. The built-in web_search, file_search and code_interpreter
# tools only work on providers that serve Responses natively.`;
}

/**
 * `~/.copilot/providers.json` for Copilot CLI BYOK. The key is literal (the
 * file does not expand `$VAR`), and an unknown model defaults to a
 * 128000-token prompt, so the limits are declared. `completions` keeps
 * Copilot on HTTP Chat Completions.
 */
export function getCopilotCliProvidersSnippet(
  baseUrl: string,
  apiKey: string,
  virtualModels: readonly string[] = [],
): string {
  return JSON.stringify(
    {
      providers: [{ name: 'thinker', type: 'openai', baseUrl, apiKey, wireApi: 'completions' }],
      models: modelIds(virtualModels).map((id) => ({
        id,
        provider: 'thinker',
        maxPromptTokens: SNIPPET_CONTEXT_WINDOW,
        maxOutputTokens: SNIPPET_MAX_TOKENS,
      })),
    },
    null,
    2,
  );
}

function getCopilotCliSnippet(baseUrl: string, apiKey: string): string {
  return `# Save as ~/.copilot/providers.json (the key is stored as plain text)
${getCopilotCliProvidersSnippet(baseUrl, apiKey)}

# Then start Copilot CLI with the Thinker model:
copilot --model thinker/auto`;
}

/**
 * Agent Pi `models.json`. Pi does not call `/v1/models` and defaults each
 * model to 128000 context, 16384 output and text only, so the metadata is
 * declared. `sendSessionAffinityHeaders` makes Pi send its session id in
 * `x-session-affinity`, which Thinker reads as the session.
 */
export function getPiModelsSnippet(
  baseUrl: string,
  apiKey: string,
  virtualModels: readonly string[] = [],
): string {
  return JSON.stringify(
    {
      $schema: 'https://pi.dev/schemas/models.schema.json',
      providers: {
        thinker: {
          name: 'Thinker',
          baseUrl,
          api: 'openai-completions',
          apiKey,
          compat: { sendSessionAffinityHeaders: true },
          models: modelIds(virtualModels).map((id) => ({
            id,
            name: modelLabel(id),
            contextWindow: SNIPPET_CONTEXT_WINDOW,
            maxTokens: SNIPPET_MAX_TOKENS,
            input: ['text', 'image'],
            reasoning: false,
          })),
        },
      },
    },
    null,
    2,
  );
}

function getPiSnippet(baseUrl: string, apiKey: string): string {
  return `# Save as ~/.pi/agent/models.json
${getPiModelsSnippet(baseUrl, apiKey)}

# Then pick the model with /model, or start Pi with:
pi --model thinker/auto`;
}

function yamlModels(virtualModels: readonly string[], indent: string): string {
  return modelIds(virtualModels)
    .map((id) =>
      [
        `${indent}- id: ${JSON.stringify(id)}`,
        `${indent}  contextWindow: ${SNIPPET_CONTEXT_WINDOW}`,
        `${indent}  maxTokens: ${SNIPPET_MAX_TOKENS}`,
      ].join('\n'),
    )
    .join('\n');
}

/**
 * DeepSeek Harness native route (Anthropic Messages), a plugin entry for
 * `$DSH_HOME/profiles/<profile>/cordis.patch.yml`. dsh appends `/v1/messages`
 * itself, and with a custom `baseURL` it lists no models, so they are
 * declared.
 */
export function getDeepSeekHarnessNativeSnippet(
  baseUrl: string,
  virtualModels: readonly string[] = [],
): string {
  return `- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    baseURL: ${stripV1Suffix(baseUrl)}
    apiKeyEnv: THINKER_AGENT_KEY
    models:
${yamlModels(virtualModels, '      ')}`;
}

/**
 * DeepSeek Harness pi-ai route (Chat Completions), the provider the dsh UI
 * "Custom model API" writes.
 */
export function getDeepSeekHarnessPiAiSnippet(
  baseUrl: string,
  virtualModels: readonly string[] = [],
): string {
  return `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      thinker:
        displayName: Thinker
        api: openai-completions
        baseURL: ${baseUrl}
        apiKeyEnv: THINKER_AGENT_KEY
        models:
${yamlModels(virtualModels, '          ')}`;
}

function getDeepSeekHarnessSnippet(baseUrl: string, apiKey: string): string {
  return `# Native route (Anthropic Messages): add to
# $DSH_HOME/profiles/<profile>/cordis.patch.yml (the Web UI profile is "web")
${getDeepSeekHarnessNativeSnippet(baseUrl)}

# Or the Chat Completions route (what Settings > Models > Custom model API writes):
${getDeepSeekHarnessPiAiSnippet(baseUrl)}

# Then, in the environment that starts dsh:
${getCodexKeyExportSnippet(apiKey)}`;
}

/** Open WebUI connection headers: one Thinker session per chat. */
export const OPEN_WEBUI_SESSION_HEADERS = '{"x-session-key": "{{CHAT_ID}}"}';

function getOpenWebUISnippet(baseUrl: string, apiKey: string): string {
  return `# Open WebUI: Admin Settings > Connections > OpenAI API > Add Connection
#   URL:       ${baseUrl}
#              (Open WebUI in Docker, Thinker on the host: host.docker.internal)
#   API Key:   ${apiKey}
#   Headers:   ${OPEN_WEBUI_SESSION_HEADERS}
#   Model IDs: leave empty; Open WebUI lists auto and the virtual models
#              from /v1/models.
# Or by environment:
OPENAI_API_BASE_URL=${baseUrl}
OPENAI_API_KEY=${apiKey}`;
}

function getChatwootSnippet(baseUrl: string, apiKey: string): string {
  return `# Chatwoot: Super Admin > Settings (App Configs) > Captain
#   OpenAI API Key:      ${apiKey}
#   OpenAI API Endpoint: ${stripV1Suffix(baseUrl)}
#                        (no /v1: Chatwoot appends /v1 itself)
#   OpenAI Model:        auto
# Captain embeddings and audio transcription use the same endpoint and pass
# through Thinker; set the Embedding Model to one your providers serve.`;
}

/**
 * Claude Desktop third-party inference in gateway mode. Model discovery only
 * shows Claude ids, so `auto` and the virtual models are declared in
 * `inferenceModels`; `behavesAs` lends them that model's Effort controls and
 * context window.
 */
export function getClaudeAppConfigSnippet(
  baseUrl: string,
  apiKey: string,
  virtualModels: readonly string[] = [],
): string {
  return JSON.stringify(
    {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: stripV1Suffix(baseUrl),
      inferenceGatewayApiKey: apiKey,
      inferenceGatewayAuthScheme: 'bearer',
      inferenceModels: modelIds(virtualModels).map((name) => ({
        name,
        labelOverride: `Thinker ${name}`,
        behavesAs: 'claude-sonnet-5-5',
      })),
    },
    null,
    2,
  );
}

function getClaudeAppSnippet(baseUrl: string, apiKey: string): string {
  return `# Claude Desktop: Help > Troubleshooting > Enable Developer Mode, then
# Developer > Configure Third-Party Inference, Inference provider "Gateway".
# The same keys work in the configuration JSON or an MDM profile:
${getClaudeAppConfigSnippet(baseUrl, apiKey)}
# Apply Changes, then quit and reopen Claude Desktop.`;
}

function getLangflowSnippet(baseUrl: string, apiKey: string): string {
  return `# Langflow server environment: its SSRF guard blocks private and plain-HTTP
# hosts until they are allowed (hostname, IP or CIDR; no scheme, no port).
LANGFLOW_SSRF_ALLOWED_HOSTS=${hostOf(baseUrl)}
# Then Settings > Model Providers > OpenAI Compatible:
#   Base URL: ${baseUrl}
#   API Key:  ${apiKey}
# Enable the discovered models (auto and the virtual models) and pick one in
# a Language Model or Agent component. Langflow in a container reaches a
# Thinker on the host through host.docker.internal.`;
}

/** Request body for a Webhooks by Zapier Custom Request (no streaming). */
export const ZAPIER_REQUEST_BODY = `{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Your prompt" }]
}`;

function getZapierSnippet(baseUrl: string, apiKey: string): string {
  return `# Zapier: add a "Webhooks by Zapier" action with the "Custom Request" event.
# Zaps run in Zapier's cloud: the URL must be public (HTTPS), not localhost.
#   Method:  POST
#   URL:     ${baseUrl}/chat/completions
#   Headers: Authorization  Bearer ${apiKey}
#            Content-Type   application/json
#            x-session-key  a name for this Zap (optional)
#   Data:
${ZAPIER_REQUEST_BODY}
# Leave "stream" off: Zapier does not read SSE and stops an action after 30 s.
# Read the reply from choices[0].message.content.`;
}

/** Which platforms have a first-class setup snippet, and which function renders it. */
export const PLATFORM_SETUP_SNIPPETS: Readonly<
  Record<string, (baseUrl: string, apiKey: string) => string>
> = {
  openclaw: (baseUrl, apiKey) => getOpenClawSnippet(baseUrl, apiKey),
  'claude-code': getClaudeCodeSettingsSnippet,
  'claude-app': getClaudeAppSnippet,
  nanobot: getNanobotConfigSnippet,
  codex: getCodexSnippet,
  'copilot-cli': getCopilotCliSnippet,
  pi: getPiSnippet,
  'deepseek-harness': getDeepSeekHarnessSnippet,
  n8n: getN8nSnippet,
  'open-webui': getOpenWebUISnippet,
  chatwoot: getChatwootSnippet,
  langflow: getLangflowSnippet,
  zapier: getZapierSnippet,
};
