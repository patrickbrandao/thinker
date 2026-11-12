// GENERATED FILE — do not edit by hand.
// Source: thinker-shared (SHARED_PROVIDERS + SUPPORTED_SUBSCRIPTION_PROVIDER_IDS).
// Refresh with: npm run gen (runs automatically in npm run build).

export interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  aliases?: readonly string[];
  authTypes: readonly string[];
}

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: 'qwen',
    displayName: 'Alibaba Cloud',
    aliases: ['alibaba'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'atlascloud',
    displayName: 'Atlas Cloud',
    aliases: ['atlas-cloud', 'atlas cloud'],
    authTypes: ['api_key'],
  },
  {
    id: 'bedrock',
    displayName: 'AWS Bedrock',
    aliases: ['aws-bedrock', 'aws bedrock', 'amazon-bedrock', 'amazon bedrock'],
    authTypes: ['api_key'],
  },
  {
    id: 'vertex',
    displayName: 'Google Vertex AI',
    aliases: ['google-vertex', 'google vertex', 'vertex-ai', 'vertex ai'],
    authTypes: ['api_key'],
  },
  {
    id: 'byteplus',
    displayName: 'BytePlus',
    aliases: ['byteplus-plan', 'byteplus plan', 'modelark', 'modelark-coding-plan'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'cline-pass',
    displayName: 'ClinePass',
    aliases: ['cline'],
    authTypes: ['subscription'],
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras',
    authTypes: ['api_key'],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    authTypes: ['api_key'],
  },
  {
    id: 'edenai',
    displayName: 'Eden AI',
    aliases: ['eden-ai', 'eden ai'],
    authTypes: ['api_key'],
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    aliases: ['fireworks-ai', 'fireworks ai', 'fireworksai'],
    authTypes: ['api_key'],
  },
  {
    id: 'groq',
    displayName: 'Groq',
    authTypes: ['api_key'],
  },
  {
    id: 'huggingface',
    displayName: 'Hugging Face',
    aliases: ['hugging-face', 'hugging face', 'hf'],
    authTypes: ['api_key'],
  },
  {
    id: 'kilo',
    displayName: 'Kilo',
    aliases: ['kilocode', 'kilo-code'],
    authTypes: ['api_key'],
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    authTypes: ['subscription'],
  },
  {
    id: 'commandcode',
    displayName: 'Command Code',
    aliases: ['command-code', 'command code', 'cmd'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'gemini',
    displayName: 'Google',
    aliases: ['google'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    authTypes: ['subscription'],
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'meta',
    displayName: 'Meta',
    authTypes: ['api_key'],
  },
  {
    id: 'xiaomi',
    displayName: 'Xiaomi MiMo',
    aliases: ['mimo', 'xiaomi-mimo', 'xiaomi mimo'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot',
    aliases: ['kimi'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'nous',
    displayName: 'NousResearch',
    aliases: ['nousresearch', 'nous-research', 'nous research'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    aliases: ['nvidia-nim', 'nvidia nim', 'nvidianim', 'nim'],
    authTypes: ['api_key'],
  },
  {
    id: 'llamacpp',
    displayName: 'llama.cpp',
    aliases: ['llama.cpp', 'llama-cpp'],
    authTypes: ['local'],
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio',
    aliases: ['lm-studio', 'lm studio'],
    authTypes: ['local'],
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    authTypes: ['local'],
  },
  {
    id: 'ollama-cloud',
    displayName: 'Ollama Cloud',
    authTypes: ['subscription'],
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'pioneer',
    displayName: 'Fastino',
    aliases: ['pioneer-ai', 'pioneer ai', 'fastino'],
    authTypes: ['api_key'],
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    aliases: ['opencodego'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    aliases: ['opencode-zen', 'opencodezen'],
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    authTypes: ['api_key'],
  },
  {
    id: 'requesty',
    displayName: 'Requesty',
    authTypes: ['api_key'],
  },
  {
    id: 'xai',
    displayName: 'xAI',
    authTypes: ['api_key', 'subscription'],
  },
  {
    id: 'zai',
    displayName: 'Z.ai',
    aliases: ['z.ai'],
    authTypes: ['api_key', 'subscription'],
  },
];

export interface PlatformCatalogEntry {
  id: string;
  surface: 'chat_completions' | 'messages' | 'responses';
}

export const PLATFORM_CATALOG: readonly PlatformCatalogEntry[] = [
  {
    id: 'openclaw',
    surface: 'chat_completions',
  },
  {
    id: 'hermes',
    surface: 'chat_completions',
  },
  {
    id: 'nanobot',
    surface: 'chat_completions',
  },
  {
    id: 'craft',
    surface: 'chat_completions',
  },
  {
    id: 'claude-app',
    surface: 'messages',
  },
  {
    id: 'n8n',
    surface: 'responses',
  },
  {
    id: 'zapier',
    surface: 'chat_completions',
  },
  {
    id: 'langflow',
    surface: 'chat_completions',
  },
  {
    id: 'chatwoot',
    surface: 'chat_completions',
  },
  {
    id: 'open-webui',
    surface: 'chat_completions',
  },
  {
    id: 'claude-code',
    surface: 'messages',
  },
  {
    id: 'opencode',
    surface: 'chat_completions',
  },
  {
    id: 'codex',
    surface: 'responses',
  },
  {
    id: 'deepseek-harness',
    surface: 'messages',
  },
  {
    id: 'pi',
    surface: 'chat_completions',
  },
  {
    id: 'cline',
    surface: 'chat_completions',
  },
  {
    id: 'copilot-cli',
    surface: 'chat_completions',
  },
  {
    id: 'openai-sdk',
    surface: 'chat_completions',
  },
  {
    id: 'anthropic-sdk',
    surface: 'messages',
  },
  {
    id: 'vercel-ai-sdk',
    surface: 'chat_completions',
  },
  {
    id: 'langchain',
    surface: 'chat_completions',
  },
  {
    id: 'curl',
    surface: 'chat_completions',
  },
  {
    id: 'other',
    surface: 'chat_completions',
  },
];

/** Valid --category values (source: thinker-shared AGENT_CATEGORIES). */
export const CATEGORY_CATALOG: readonly string[] = ['personal', 'automation', 'app', 'coding'];

/** Setup snippets with {{ORIGIN}} / {{API_KEY}} placeholders, rendered from thinker-shared. */
export const SETUP_TEMPLATES: Readonly<Record<string, string>> = {
  openclaw:
    'openclaw config set models.providers.thinker \'{"baseUrl":"{{ORIGIN}}/v1","api":"openai-completions","apiKey":"{{API_KEY}}","models":[{"id":"auto","name":"Thinker Auto","input":["text","image"],"contextWindow":128000,"maxTokens":16384,"compat":{"supportsUsageInStreaming":true}}]}\'\nopenclaw config set agents.defaults.model.primary thinker/auto\nopenclaw gateway restart',
  'claude-code':
    '{\n  "model": "auto",\n  "env": {\n    "ANTHROPIC_BASE_URL": "{{ORIGIN}}",\n    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}"\n  }\n}',
  'claude-app':
    '# Claude Desktop: Help > Troubleshooting > Enable Developer Mode, then\n# Developer > Configure Third-Party Inference, Inference provider "Gateway".\n# The same keys work in the configuration JSON or an MDM profile:\n{\n  "inferenceProvider": "gateway",\n  "inferenceGatewayBaseUrl": "{{ORIGIN}}",\n  "inferenceGatewayApiKey": "{{API_KEY}}",\n  "inferenceGatewayAuthScheme": "bearer",\n  "inferenceModels": [\n    {\n      "name": "auto",\n      "labelOverride": "Thinker auto",\n      "behavesAs": "claude-sonnet-5-5"\n    }\n  ]\n}\n# Apply Changes, then quit and reopen Claude Desktop.',
  nanobot:
    '{\n  "agents": {\n    "defaults": {\n      "provider": "custom",\n      "model": "auto"\n    }\n  },\n  "providers": {\n    "custom": {\n      "apiKey": "{{API_KEY}}",\n      "apiBase": "{{ORIGIN}}/v1"\n    }\n  }\n}',
  codex:
    '# Add to ~/.codex/config.toml\nmodel = "auto"\nmodel_provider = "thinker"\n# Codex does not read Thinker\'s /v1/models: for "auto" and virtual models it\n# assumes a 272K window and compacts too late on smaller routes. Set this to\n# the smallest context window behind the model (harness Models tab).\nmodel_context_window = 128000\n\n[model_providers.thinker]\nname = "Thinker"\nbase_url = "{{ORIGIN}}/v1"\nenv_key = "THINKER_AGENT_KEY"\nwire_api = "responses"\n\n# Then, in the terminal that launches Codex:\nexport THINKER_AGENT_KEY="{{API_KEY}}"',
  'copilot-cli':
    '# Save as ~/.copilot/providers.json (the key is stored as plain text)\n{\n  "providers": [\n    {\n      "name": "thinker",\n      "type": "openai",\n      "baseUrl": "{{ORIGIN}}/v1",\n      "apiKey": "{{API_KEY}}",\n      "wireApi": "completions"\n    }\n  ],\n  "models": [\n    {\n      "id": "auto",\n      "provider": "thinker",\n      "maxPromptTokens": 128000,\n      "maxOutputTokens": 16384\n    }\n  ]\n}\n\n# Then start Copilot CLI with the Thinker model:\ncopilot --model thinker/auto',
  pi: '# Save as ~/.pi/agent/models.json\n{\n  "$schema": "https://pi.dev/schemas/models.schema.json",\n  "providers": {\n    "thinker": {\n      "name": "Thinker",\n      "baseUrl": "{{ORIGIN}}/v1",\n      "api": "openai-completions",\n      "apiKey": "{{API_KEY}}",\n      "compat": {\n        "sendSessionAffinityHeaders": true\n      },\n      "models": [\n        {\n          "id": "auto",\n          "name": "Thinker Auto",\n          "contextWindow": 128000,\n          "maxTokens": 16384,\n          "input": [\n            "text",\n            "image"\n          ],\n          "reasoning": false\n        }\n      ]\n    }\n  }\n}\n\n# Then pick the model with /model, or start Pi with:\npi --model thinker/auto',
  'deepseek-harness':
    '# Native route (Anthropic Messages): add to\n# $DSH_HOME/profiles/<profile>/cordis.patch.yml (the Web UI profile is "web")\n- id: llm-deepseek\n  name: \'@deepseek-ai/dsh-llm-deepseek-api-key\'\n  config:\n    baseURL: {{ORIGIN}}\n    apiKeyEnv: THINKER_AGENT_KEY\n    models:\n      - id: "auto"\n        contextWindow: 128000\n        maxTokens: 16384\n\n# Or the Chat Completions route (what Settings > Models > Custom model API writes):\n- id: llm-pi-ai\n  name: \'@deepseek-ai/dsh-llm-pi-ai\'\n  config:\n    providers:\n      thinker:\n        displayName: Thinker\n        api: openai-completions\n        baseURL: {{ORIGIN}}/v1\n        apiKeyEnv: THINKER_AGENT_KEY\n        models:\n          - id: "auto"\n            contextWindow: 128000\n            maxTokens: 16384\n\n# Then, in the environment that starts dsh:\nexport THINKER_AGENT_KEY="{{API_KEY}}"',
  n8n: '# In n8n, add the built-in OpenAI Chat Model node to your AI Agent / Basic\n# LLM Chain. Create an OpenAI credential with:\n#   Base URL: {{ORIGIN}}/v1\n#   API Key:  {{API_KEY}}\n#   Model:    auto\n# n8n sends no session id: in the credential, use "Add Custom Header" with\n#   Name:  x-session-key\n#   Value: a name for this workflow (one credential per workflow keeps\n#          each workflow\'s requests together).\n# Node version 1.3 turns "Use Responses API" on by default and calls\n# /v1/responses. Turn it off when your providers have no Responses API: the\n# node then sends Chat Completions, which Thinker forwards without\n# translation. The built-in web_search, file_search and code_interpreter\n# tools only work on providers that serve Responses natively.',
  'open-webui':
    '# Open WebUI: Admin Settings > Connections > OpenAI API > Add Connection\n#   URL:       {{ORIGIN}}/v1\n#              (Open WebUI in Docker, Thinker on the host: host.docker.internal)\n#   API Key:   {{API_KEY}}\n#   Headers:   {"x-session-key": "{{CHAT_ID}}"}\n#   Model IDs: leave empty; Open WebUI lists auto and the virtual models\n#              from /v1/models.\n# Or by environment:\nOPENAI_API_BASE_URL={{ORIGIN}}/v1\nOPENAI_API_KEY={{API_KEY}}',
  chatwoot:
    '# Chatwoot: Super Admin > Settings (App Configs) > Captain\n#   OpenAI API Key:      {{API_KEY}}\n#   OpenAI API Endpoint: {{ORIGIN}}\n#                        (no /v1: Chatwoot appends /v1 itself)\n#   OpenAI Model:        auto\n# Captain embeddings and audio transcription use the same endpoint and pass\n# through Thinker; set the Embedding Model to one your providers serve.',
  langflow:
    '# Langflow server environment: its SSRF guard blocks private and plain-HTTP\n# hosts until they are allowed (hostname, IP or CIDR; no scheme, no port).\nLANGFLOW_SSRF_ALLOWED_HOSTS=<thinker-host>\n# Then Settings > Model Providers > OpenAI Compatible:\n#   Base URL: {{ORIGIN}}/v1\n#   API Key:  {{API_KEY}}\n# Enable the discovered models (auto and the virtual models) and pick one in\n# a Language Model or Agent component. Langflow in a container reaches a\n# Thinker on the host through host.docker.internal.',
  zapier:
    '# Zapier: add a "Webhooks by Zapier" action with the "Custom Request" event.\n# Zaps run in Zapier\'s cloud: the URL must be public (HTTPS), not localhost.\n#   Method:  POST\n#   URL:     {{ORIGIN}}/v1/chat/completions\n#   Headers: Authorization  Bearer {{API_KEY}}\n#            Content-Type   application/json\n#            x-session-key  a name for this Zap (optional)\n#   Data:\n{\n  "model": "auto",\n  "messages": [{ "role": "user", "content": "Your prompt" }]\n}\n# Leave "stream" off: Zapier does not read SSE and stops an action after 30 s.\n# Read the reply from choices[0].message.content.',
};
