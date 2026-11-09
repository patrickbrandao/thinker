/** Harness list, harness detail shell and settings, setup guides, integrations, email provider. */
export default {
  category: {
    personal: 'AI agent',
    automation: 'Automation',
    app: 'App AI SDK',
    coding: 'Coding Assistant',
  },
  platformOther: 'Other',
  key: {
    revealAria: 'Reveal API key',
    hideAria: 'Hide API key',
    revealInCodeAria: 'Reveal API key in code',
    hideInCodeAria: 'Hide API key in code',
    reveal: 'Reveal key',
    hide: 'Hide key',
    revealShort: 'Reveal',
    hideShort: 'Hide',
  },
  deleted: 'Harness "{{ name }}" deleted',
  workspace: {
    title: 'My Harnesses',
    metaDescription: 'View and manage all your harnesses. Monitor usage, requests, and costs.',
    subtitle: 'View and manage all your connected harnesses',
    layout: 'Harness list layout',
    gridView: 'Grid view',
    tableView: 'Table view',
    connect: 'Connect Harness',
    colHarness: 'Harness',
    colRequests: 'Requests',
    colTokens: 'Tokens',
    colCost: 'Cost',
    colLastActive: 'Last active',
    emptyTitle: 'No harnesses yet',
    emptyBody: 'Connect a harness or an AI app to take control of your routing and your costs.',
    connectFirst: 'Connect your first harness',
    duplicate: 'Duplicate',
    actionsFor: 'Actions for {{ name }}',
    deleteTitle: 'Delete {{ name }}',
    deleteBody:
      'This will permanently delete the {{ name }} harness and all its data. This action cannot be undone.',
    deleteConfirm: 'To confirm, type {{ name }} below',
    deleteButton: 'Delete harness',
  },
  detail: {
    back: '← Harnesses',
    overview: 'Overview',
    routing: 'Routing',
    models: 'Models',
    providers: 'Providers',
    limits: 'Limits',
    settings: 'Settings',
    triggers: 'Triggers',
    connection: 'Connection',
  },
  settings: {
    pageTitle: '{{ name }} Settings',
    metaDescription: 'Configure settings for {{ name }}.',
    intro: 'Rename the harness, change its type and manage its API key',
    readOnly: "You have read-only access. Viewers can't change harness settings.",
    nameTitle: 'Harness name',
    nameDesc: 'The display name for this harness across the dashboard.',
    typeTitle: 'Harness type',
    notSet: 'Not set',
    change: 'Change',
    errorMessage: 'An error occurred.',
    apiKeyTitle: 'API Key',
    apiKeyLabel: 'Harness API key',
    apiKeyDesc:
      "This key authenticates your harness's requests to Thinker. Rotating it generates a new key and immediately invalidates the current one.",
    rotating: 'Rotating...',
    rotate: 'Rotate key',
    rotated: 'API key rotated successfully',
    setupTitle: 'Setup',
    keyLoadError: 'Could not load your API key. Use {{ rotate }} above to generate a new one.',
    dangerTitle: 'Danger zone',
    deleteTitle: 'Delete this harness',
    deleteDesc:
      'Permanently delete this harness, its API key, and all messages and analytics. This action cannot be undone.',
    deleteButton: 'Delete harness',
    deleteModalTitle: 'Delete {{ name }}',
    deleteModalBody:
      'This will permanently delete the {{ name }} harness and all its data. This action cannot be undone.',
    deleteModalConfirm: 'To confirm, type {{ name }} in the box below',
    deleteModalButton: 'Delete this harness',
    changeTypeTitle: 'Change harness type',
    changeTypeDesc: 'Select the new type and platform for this harness.',
  },
  connection: {
    pageTitle: '{{ name }} Connection',
    intro:
      'How to point this harness at Thinker: the suggested setup for its type and copyable SDK examples.',
    setupTitle: 'Suggested setup',
    sdkTitle: 'SDK code examples',
    sdkDesc: 'Call the gateway from your own code. Pick the SDK and the model the example sends.',
  },
  recording: {
    title: 'Logs',
    enable: 'Enable logs',
    desc: 'Log the full content of every request and every attempt, so you can see what your agent sends. You will find these logs on the Requests page, inside each request. Logs stay in your own database.',
    enabledToast: 'Logs enabled',
    disabledToast: 'Logs disabled',
  },
  modelsTab: {
    title: '{{ name }} Models',
    intro:
      'The models this harness lists in GET /v1/models, in the same order. Send any of these ids in the "model" field.',
    listing: 'Listing: {{ mode }}.',
    changeListing: 'Change in Settings',
    count: '{{ n }} models',
    countOne: '1 model',
    search: 'Filter models',
    colModel: 'Model',
    colType: 'Type',
    colProvider: 'Provider',
    colContext: 'Context',
    colInput: 'Input /1M',
    colOutput: 'Output /1M',
    colDetails: 'Details',
    kindAuto: 'Auto',
    kindVirtual: 'Virtual',
    kindModel: 'Model',
    autoDetails: "Routes each request through this harness's routing (Routing tab).",
    primary: 'Primary: {{ model }}',
    noPrimary: 'No primary model',
    fallbacks: '{{ n }} fallbacks',
    fallbacksOne: '1 fallback',
    continueOnDefault: 'continues on auto',
    stream: 'stream',
    reasoning: 'reasoning',
    code: 'code',
    varies: 'Varies',
    loadFailed: 'Failed to load the model list',
    empty: 'No models match the filter.',
  },
  modelListing: {
    title: 'Model listing',
    label: 'Models in /v1/models',
    closed: 'Closed',
    restricted: 'Restricted',
    open: 'Open',
    closedDesc: 'Lists only auto and the virtual models.',
    restrictedDesc: 'Lists auto, the virtual models and the models they route and fall back to.',
    openDesc: 'Lists every available model (default).',
    savedToast: 'Model listing updated',
  },
  help: {
    title: 'Help & Support',
    metaDescription: 'Get help with Thinker: documentation and issue tracker.',
    subtitle: 'Questions, bugs or ideas? Thinker is open source and tracked on GitHub',
    docsTitle: 'Documentation',
    docsDesc: 'Installation, configuration and provider guides.',
    openDocs: 'Open docs',
    issuesTitle: 'Issues',
    issuesDesc:
      'Report a bug or ask a question on GitHub. Leave out keys, tokens and request logs.',
    openIssues: 'Open issues',
  },
  cli: {
    metaDescription:
      'Install the thinker CLI and manage harnesses, providers, routing and request logs from the terminal.',
    subtitle: 'Everything the dashboard does, from a terminal, a script, or a coding agent',
    installTitle: '1. Install',
    installDesc:
      'The CLI ships in the Thinker repository. Install it from a checkout of the release that matches this instance; the command is {{ command }}.',
    signInTitle: '2. Sign in',
    signInDesc:
      'This opens your browser, you approve, and the CLI stores a token for this host. The token never travels through the URL.',
    driveTitle: '3. Drive it',
    documentation: 'Documentation',
    driveDesc:
      'Create a harness, connect a provider, set a route, and prove it works with one real request.',
  },
  mcp: {
    title: 'MCP server',
    metaDescription:
      'Connect Claude, Cursor, Codex and other MCP clients to this Thinker install over OAuth.',
    subtitle: 'Manage harnesses, providers, routing and the request log from any MCP client',
    unavailableTitle: 'Not available on this install',
    unavailableDesc:
      'The MCP server needs this install to be reachable over HTTPS, because MCP clients authorize against an HTTPS resource URL. It is switched off here, either because {{ authUrl }} is a plain-HTTP address or because {{ flag }} is set. The dashboard, the gateway and the CLI are unaffected.',
    endpointTitle: 'Your endpoint',
    endpointDesc:
      'Point any MCP client here. It signs in with OAuth, so the first connection opens a consent screen in your browser and keeps a short-lived, revocable token.',
    connectTitle: 'Connect your client',
    clientTabs: 'MCP client',
    modeTitle: 'Read-only or read-and-write',
    toolList: 'Full tool list',
    modeDesc:
      'The consent screen asks which you want. A read-only connection never sees the write tools at all, so it can look but not touch.',
  },
  typeSelect: {
    aria: 'Harness type: {{ type }}',
    select: 'Select',
  },
  add: {
    title: 'Connect Harness',
    desc: 'Name your harness to start tracking its LLM usage, costs, and messages in real time.',
    type: 'Type',
    name: 'Harness name',
    namePlaceholder: 'e.g. my-harness',
    nameHint: 'Lowercase letters, numbers and hyphens (a-z, 0-9, -), like a DNS name.',
    nameInvalid: 'The name cannot start or end with a hyphen.',
    settings: 'Settings',
    enableLogs: 'Enable logs',
    logsHint:
      'See exactly what your agent sends on every attempt, and debug it faster. Logs stay in your own database.',
    tabHarness: 'Harness',
    tabSettings: 'Settings',
  },
  retention: {
    control: 'Retention control',
    daysLabel: 'Retention days',
    label: 'Log retention',
    hint: 'How long requests keep their logs (bodies, headers, parameters). Tokens, costs and status are kept.',
    global: 'Global',
    custom: 'Custom',
    days: (n: number) => `${n} day${n === 1 ? '' : 's'}`,
    savedToast: 'Log retention saved',
  },
  duplicateModal: {
    title: 'Duplicate "{{ name }}"',
    desc: 'Creates a new harness with the same providers, routing, and tier configuration. A fresh API key is generated. Telemetry and request history stay with the original.',
    newName: 'New harness name',
    copyPlaceholder: '{{ name }}-copy',
    copied: 'What is copied',
    providers: (n: number) =>
      `provider credential${n === 1 ? '' : 's'} (encrypted API keys & subscriptions)`,
    tiers: (n: number) => `tier override${n === 1 ? '' : 's'}`,
    specificity: (n: number) => `specificity override${n === 1 ? '' : 's'}`,
    notCopied: 'What is not copied',
    requests: 'Requests',
    logs: 'Logs',
    notificationRules: 'Notification rules',
    submit: 'Duplicate harness',
    done: 'Duplicated "{{ source }}" to "{{ target }}"',
  },
  setupModal: {
    title: 'Set up harness: {{ name }}',
    desc: 'Connect your harness to Thinker to start routing requests.',
    keyErrorTitle: 'Could not load API key',
    keyErrorMessage: "Failed to fetch your harness's API key. Please try again.",
  },
  setupStep: {
    connectNamed: 'Connect your {{ name }} harness to Thinker',
    connectTool: 'Connect {{ name }} to Thinker',
    connectDefault: 'Connect your harness to Thinker',
    pointAt: 'Point your harness at the Thinker endpoint using the model {{ model }}',
    method: 'Setup method',
    agents: 'Agents',
    toolkits: 'Toolkits',
    framework: 'Agent framework',
  },
  guides: {
    claudeSettings:
      'Add this block to {{ file }}. Every {{ cmd }} run will route through Thinker with {{ auto }}.',
    claudeContext:
      'Through a gateway, Claude Code assumes a 200k context window and compacts long sessions early. For long-context work, pin a 1M model instead of {{ auto }}, for example {{ example }}.',
    codexConfig:
      'Add this block to your global {{ file }}. Codex CLI and Desktop both read this file. Restart Codex after you save it.',
    codexExport:
      'Export your Thinker key, then launch Codex CLI from the same terminal. For Desktop, make this variable available in the environment that launches the app, then fully quit and reopen Codex. An export in a separate terminal does not update a running app.',
    craft:
      'In Craft, add an API-key connection with a custom OpenAI-compatible endpoint. Set the base URL to {{ url }} {{ copy }}, use model {{ auto }} and paste this API key:',
    nanobot:
      'Edit {{ file }} by updating the existing {{ defaults }} values first, then add the {{ custom }} provider block below.',
    openCode: 'Add this block to your global {{ file }}.',
    configMethod: 'Configuration method',
    configValues: 'Configuration values',
    hermesIntro: 'Point Hermes at the Thinker endpoint to route requests across multiple models.',
    hermesFileTab: 'Configuration file',
    hermesOpen: 'Open the Hermes configuration file:',
    hermesAdd: 'Add the following {{ section }} section to your {{ file }}:',
    wizard:
      'Run the onboarding wizard and select {{ option }} when prompted. Then enter the following values:',
    n8nIntro:
      'In n8n, add the built-in OpenAI Chat Model node to your AI Agent or Basic LLM Chain. Create an OpenAI credential, paste the values below (the Base URL points it at Thinker), and set the node model to {{ auto }}.',
    n8nReference: 'Reference:',
    n8nDocs: 'n8n OpenAI credential docs',
    n8nValues: 'n8n credential values',
    openClawIntro:
      'Register Thinker in your OpenClaw config to route each request to the best provider using the model {{ model }}',
    openClawCliTab: 'CLI configuration',
    openClawCli: 'Set the provider config and default model directly via CLI commands.',
    contextHint:
      '{{ name }} does not read the model list from Thinker, so {{ field }} is set to {{ value }}, a safe default. Raise it to the smallest context window behind the model, shown in the harness Models tab.',
    craftLimits:
      'Craft registers custom-endpoint models with a 131072-token context, 8192 output tokens (which also caps the compaction summary) and no images. Set the max output and image support of the connection, and for a larger context edit the connection in {{ file }}:',
    n8nResponses:
      'Node version 1.3 turns {{ option }} on by default and calls {{ path }}. Turn it off when your providers have no Responses API: the node then sends Chat Completions, which Thinker forwards without translation. The built-in web search, file search and code interpreter tools only work on providers that serve Responses natively.',
    claudeApp:
      'In Claude Desktop, open Help > Troubleshooting > Enable Developer Mode, then Developer > Configure Third-Party Inference and choose the {{ provider }} inference provider. Fill in these values:',
    claudeAppModels:
      'Model discovery only shows Claude model ids, so {{ auto }} and your virtual models must be listed in {{ key }}. {{ behaves }} gives them the Effort controls and context window of that Claude model. The same keys work in the configuration JSON or an MDM profile:',
    claudeAppRestart:
      'Apply Changes, then quit and reopen Claude Desktop. The base URL has no {{ v1 }}: the app appends {{ path }} itself.',
    copilotCli:
      'Save this as {{ file }} (the key is stored as plain text), then start Copilot CLI with {{ cmd }}.',
    pi: 'Save this as {{ file }}, then pick the model with {{ cmd }}. {{ compat }} makes Pi send its session id, which groups each conversation in Thinker.',
    piReasoning:
      'Set {{ reasoning }} to {{ yes }} only when every route behind the model reasons (Pi then sends {{ effort }}), and drop {{ image }} when a route has no vision.',
    deepSeekIntro:
      'DeepSeek Harness reaches Thinker in two ways: the native route speaks Anthropic Messages and sends its session id; the Custom model API route speaks Chat Completions.',
    deepSeekNativeTab: 'Native route',
    deepSeekPiTab: 'Custom model API',
    deepSeekNative:
      'Add this plugin entry to {{ file }} (the Web UI profile is {{ profile }}). dsh appends {{ path }} to the base URL and lists no models from a custom base URL, so {{ auto }} and your virtual models are declared here.',
    deepSeekPi:
      'Settings > Models > Custom model API in dsh writes this provider; you can also add it to {{ file }}. The base URL keeps {{ v1 }}.',
    deepSeekKey: 'Then export your Thinker key in the environment that starts dsh:',
    openWebUI:
      'In Open WebUI, open Admin Settings > Connections > OpenAI API and add a connection with these values. Leave Model IDs empty: Open WebUI lists {{ auto }} and your virtual models from {{ models }}.',
    openWebUIDocker:
      'When Open WebUI runs in Docker and Thinker on the host, replace {{ localhost }} with {{ docker }} in the URL.',
    openWebUISession:
      'The {{ header }} header gives each chat its own Thinker session (prompt cache and routing momentum). Thinker also reads {{ chatId }} when Open WebUI runs with {{ env }}.',
    openWebUITask:
      'Tip: set a cheaper {{ task }} so titles, tags and follow-up suggestions do not use the chat model.',
    chatwoot:
      'In Chatwoot, open Super Admin > Settings > Captain and fill in these values. The endpoint has no {{ v1 }}: Chatwoot appends it, so an endpoint ending in {{ v1 }} calls {{ double }} and fails.',
    chatwootExtras:
      'Captain embeddings and audio transcription use the same endpoint and pass through Thinker; set the Embedding Model to one your providers serve.',
    langflow:
      'Langflow blocks private and plain-HTTP hosts until they are allowed. Add this to the environment of the Langflow server and restart it (hostname, IP or CIDR; no scheme, no port):',
    langflowProvider:
      'Then open Settings > Model Providers > OpenAI Compatible, fill in these values and enable the discovered models ({{ auto }} and your virtual models). Langflow in a container reaches a Thinker on the host through {{ docker }}.',
    zapier:
      'Zapier AI apps take no custom base URL, so call Thinker from a Webhooks by Zapier action with the Custom Request event. Zaps run in the Zapier cloud: the URL must be public (HTTPS), not {{ localhost }}.',
    zapierBody:
      'Use this as the request data. Leave {{ stream }} off: Zapier does not read streamed replies and stops an action after 30 seconds, so pick a fast model. The reply is in {{ path }}.',
    zapierSession:
      'Optional: add an {{ header }} header with a name for the Zap to group its calls in one session.',
    values: 'Values to fill in',
  },
  snippets: {
    toolkitTabs: 'SDK / toolkit',
    language: 'Language',
    openaiApi: 'OpenAI API',
    model: 'Model',
    connectionDetails: 'Connection details',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    header: 'Header',
  },
};
