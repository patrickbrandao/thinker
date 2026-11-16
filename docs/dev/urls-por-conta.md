# Especificação: URLs editáveis por conta

> Status: **backend implementado** (ver [Implementação: desvios e decisões](#implementação-desvios-e-decisões)). Decisão em [ADR 0012](../adr/0012-urls-editaveis-por-conta.md).

## Objetivo

Toda URL que uma conta de provedor usa pode ser trocada na própria conta, ao adicionar e ao editar, numa guia **URLs** separada dos campos obrigatórios. Vale para contas por chave de API ("Por uso"), por assinatura, servidores locais e provedores custom.

## Modelo

### Slot

Um slot é uma URL nomeada de um provedor:

```ts
// packages/shared/src/provider-urls.ts
export type ProviderUrlKind = 'base' | 'url';
// base: substitui a base; o caminho do provedor é acrescentado (inferência).
// url:  é usada como está (endpoint de token, de uso, de listagem...).
export type ProviderUrlCredential = 'none' | 'access' | 'refresh' | 'secret';
// o que vai para essa URL: nada, token/chave de acesso, refresh token ou
// segredo de cliente / código de autorização.
export interface ProviderUrlSlot {
  id: string;            // estável, snake_case: 'inference', 'inference_responses', 'models', 'oauth_token'...
  purpose: string;       // chave de tradução da finalidade (dashboard)
  kind: ProviderUrlKind;
  credential: ProviderUrlCredential;
  authTypes: Array<'api_key' | 'subscription'>; // em que tipo de conta o slot existe
}
export const PROVIDER_URL_SLOTS: Record<string, ProviderUrlSlot[]>; // por id de provedor
```

O **padrão** de cada slot é calculado no backend (depende de região, plano, projeto do Vertex etc.) por uma função única, `defaultProviderUrl(provider, authType, region, slotId)`, que é a mesma usada para resolver a URL sem override. Assim o padrão mostrado na tela é exatamente o que a conta usa.

### Armazenamento

- `tenant_providers.url_overrides` (`jsonb`, nulo): `{ [slotId]: url }`. Só guarda o que difere do padrão.
- `tenant_providers.base_url` continua existindo e passa a ser o slot `inference` (leitura e escrita pelo novo caminho; a coluna fica para compatibilidade e rollback). Migração copia nada: `base_url` já é o valor do slot `inference`.
- Provedores custom e servidores locais continuam com `custom_providers.base_url` / `local_config`; a guia URLs só reorganiza esses campos na tela.

### Resolução (ponto único)

`resolveProviderUrl(connection, slotId, ctx)` no backend devolve `{ url, overridden, allowPrivate }`. Toda chamada de saída de uma conta passa por ele: `ProviderClient` (inferência, depois de escolher a variante de formato do modelo, não antes), `buildEndpointOverride`, o fetcher de modelos (`PROVIDER_CONFIGS`, inclusive os caminhos de retorno antecipado de Fireworks, Pioneer, OpenCode e Cline), Bedrock CRIS, detecção de região do Qwen, serviços de OAuth (authorize, token, refresh, revoke, device code), troca de token do Copilot, Code Assist, Kiro (OIDC e inferência), console e uso do OpenCode.

Regras:

1. Override vence região; região vence o padrão do provedor.
2. Com override, a requisição usa `ssrfSafeFetch` com revalidação e `redirect: 'error'` (também nos POSTs de token/refresh/revoke).
3. O valor é guardado como digitado, sem a barra final; **não** se remove `/v1` (corrige o defeito de Atlas Cloud/Requesty).
4. Com override no slot de inferência, a escolha de variante continua (OpenAI → Responses, xAI → Responses, OpenCode → `-responses`/`-anthropic`/`-google`, Command Code → Anthropic): cada variante tem seu slot, cujo padrão, quando só a base de inferência foi trocada, deriva dela.

### Catálogo de slots (mínimo por provedor)

Fonte: inventário de 15/11/2026 (arquivos citados são os pontos de definição atuais).

| Provedor | Slots |
| --- | --- |
| Chave de API, provedores OpenAI-compatíveis (deepseek, cerebras, groq, huggingface, kilo, mistral, atlascloud, edenai, requesty, nous, meta, xiaomi, moonshot, nvidia, zai, openrouter, ollama-cloud, cline-pass, pioneer, fireworks, byteplus, commandcode, minimax, qwen, gemini/google, vertex, anthropic) | `inference` (base), `models` (url) e as variantes que o provedor tiver (`inference_anthropic` em byteplus/commandcode, `inference_responses` em openai/xai). Pioneer também `models_base_catalog`; Cline `models_recommended`; Qwen `region_probe` (as três URLs de detecção). |
| openai (chave) | `inference`, `inference_responses`, `models` |
| bedrock (chave) | `inference_mantle`, `inference_runtime`, `models`, `cris_profiles` |
| opencode / opencode-go (chave) | `inference_openai`, `inference_anthropic`, `inference_google`, `models`; opencode-go também `usage` |
| openai (assinatura ChatGPT/Codex) | `oauth_authorize`, `oauth_token` (exchange e refresh), `oauth_revoke`, `inference`, `models` |
| anthropic (assinatura Claude) | `oauth_authorize`, `oauth_token`, `oauth_redirect`, `inference`, `models` |
| copilot | `device_code`, `device_token`, `token_exchange`, `inference`, `models` |
| gemini (assinatura Code Assist) | `oauth_authorize`, `oauth_token`, `oauth_revoke`, `code_assist` (onboarding), `inference` |
| kiro | `oidc` (base templada por região), `start_url`, `inference`, `models` |
| minimax (assinatura) | `oauth` (base de `/oauth/code` e `/oauth/token`), `inference`, `models` |
| moonshot/kimi, zai, qwen, xiaomi, byteplus, ollama-cloud, mistral, nous, cline-pass, commandcode (assinatura) | `inference`, `models` (onde houver listagem) |
| xai (assinatura) | `oauth_authorize`, `oauth_token`, `oauth_revoke`, `inference`, `models` |
| opencode (Console) | `console` (base de device code, token, user, orgs, config), `usage`, `inference_openai`, `inference_anthropic`, `inference_google`, `models` |

URLs de callback de OAuth locais (`localhost:1455`, `127.0.0.1:56121`) fazem parte do contrato com o provedor e **não** são slots. Os catálogos públicos globais (models.dev, openrouter.ai, `models.opencode.ai`) também não.

## API

- `GET /api/v1/providers/url-slots?provider=&auth_type=&region=` → `{ slots: [{ id, purpose, kind, credential, default }] }` (para a tela de adicionar, antes de a conta existir).
- Listagem e detalhe de conexão (`GET /api/v1/providers`) passam a trazer `urls: [{ id, purpose, kind, credential, default, value }]` (`value` nulo = padrão). `base_url`/`default_base_url`/`supports_base_url` continuam por compatibilidade.
- `POST /api/v1/routing/:agent/providers` aceita `urlOverrides: { [slotId]: string }` (além de `accountBaseUrl`, que vira `urlOverrides.inference`).
- `PATCH /api/v1/providers/connections/:id/urls` com `{ overrides: { [slotId]: string | null } }` (null volta ao padrão). Substitui o `PATCH .../base-url`, que continua como atalho do slot `inference`.
- Fluxos de assinatura que criam a conta no fim (OAuth por popup, colar código, device code, Copilot, Kiro, MiniMax, OpenCode Console): o endpoint de início aceita `urlOverrides`, guardado no fluxo pendente e usado no próprio fluxo (authorize, token, device code); ao concluir, gravado na conta criada.
- Validação: `http(s)`, sem credenciais, sem query/fragmento (exceto slots `url` cujo padrão já tem query, onde a query é preservada), até 2048 caracteres, `validatePublicUrl` com a política de destino privado do usuário. Slot desconhecido para o provedor/tipo → 400.
- Permissão: contas por assinatura exigem owner ou super usuário para gravar qualquer override; chave de API segue quem pode conectar provedores.
- Auditoria: alerta `provider.urls_changed` com usuário, conta e ids dos slots alterados.

## Dashboard

- Componente único `components/ConnectionUrlsTab.tsx`, controlado (`value`/`onChange`), sem lógica de salvar: uma linha por slot com o rótulo da finalidade, o padrão como placeholder, "Restaurar padrão", e um aviso nos slots com `credential` `access`/`refresh`/`secret`: "The account's credential is sent to this URL."
- Guia **URLs** em toda tela de adicionar e editar conta:
  - adicionar conta por chave de API e por assinatura (`ProviderWizard` → `ProviderSelectContent` → `ProviderDetailView`/`ProviderKeyForm`/`OAuthDetailView`/`AnthropicOAuthDetailView`/`DeviceCodeDetailView`/`CopilotDeviceLogin`), hospedada em `TabbedWindow`;
  - adicionar/editar provedor custom (`CustomProviderForm`: a URL base vai para a guia URLs) e servidor local (`LocalServerForm`: esquema, host, porta e prefixo vão para a guia URLs);
  - editar conta (`ConnectionDetail` → janela "Manage": o campo de URL base sai de "General" e entra em "URLs");
  - onboarding (`Welcome` → `ProviderSelectModal`).
- A guia URLs nunca é a primeira e nunca é obrigatória: quem só preenche a chave e salva não a vê.
- Textos em inglês e pt-BR (`check-i18n`).

## Testes

- Tabela sobre `PROVIDER_URL_SLOTS`: para cada provedor e slot, um override faz a chamada correspondente ir para a URL alterada (mock de fetch), e sem override vai para o padrão de hoje.
- Regressões dos defeitos: variante de formato preservada com URL base; `/v1` preservado; Bedrock com dois hosts; região do CRIS.
- Segurança: redirect recusado em token/refresh com override; destino privado bloqueado conforme a política; permissão de assinatura (member recebe 403); alerta de auditoria gerado.
- Fluxos de OAuth/device code usando os overrides do início do fluxo.
- Dashboard: a guia aparece em cada superfície, salvar sem abrir a guia não envia overrides, restaurar envia `null`.

## Implementação: desvios e decisões

Backend em `packages/backend/src/routing/provider-urls/` (resumo no [guia](guia.md#roteamento-e-proxy)).

- **OpenCode e OpenCode Go ganharam o slot `inference`** (base comum, `https://opencode.ai/inference[/go]`), do qual derivam `inference_openai`/`inference_anthropic`/`inference_google` e `models`. Um `base_url` legado (`…/openai`) é lido como essa base comum, então contas antigas passam a mandar cada modelo para o protocolo certo.
- **Detecção de região do Qwen: três slots** (`region_probe_singapore`, `region_probe_us`, `region_probe_beijing`) em vez de um `region_probe` com três URLs, porque cada slot guarda uma URL. Valem só no connect (`urlOverrides` do `POST .../providers`).
- **Sem `inference_anthropic` para BytePlus por chave de API**: nenhuma chamada de conta por chave usa o endpoint Anthropic da BytePlus (ele serve só a assinatura, cujo slot é `inference`).
- **Sem `usage` para OpenCode Go por chave de API**: o medidor de uso só existe para o login do Console (precisa da organização do token).
- **Sem `models` para Vertex e para Gemini/Kimi por assinatura**: não há listagem (a descoberta usa catálogos).
- **`/v1`**: o valor é guardado como digitado (sem barra final). Na hora de montar a URL, um `/v1` final só é tirado quando o caminho do provedor já começa com `/v1` (evita `/v1/v1`); Atlas Cloud e Requesty (caminho `/chat/completions`) mantêm o `/v1`.
- **Derivação**: só variantes de protocolo e a listagem (`models`, e no Bedrock a partir de `inference_mantle`) seguem uma base de inferência sobrescrita, por reescrita de prefixo; nenhum slot que recebe refresh token deriva. Runtime do Bedrock não deriva de Mantle (hosts diferentes); um `base_url` legado do Bedrock continua valendo para os dois.
- **Fonte de verdade**: depois da primeira gravação pelo caminho novo, `url_overrides` (mesmo `{}`) é autoritativo e `base_url` vira só espelho do slot `inference` (no Bedrock, de `inference_mantle`; no OpenCode, `inference` + `/openai`) para rollback.
- **`allow_private_destination`** vale para todos os overrides da conta; a cada gravação todos os overrides restantes são revalidados com a política de quem grava.
- **Fluxos de assinatura**: corpo JSON `{ "urlOverrides": {...} }` nos POST de início (Anthropic, MiniMax, Kiro, Console do OpenCode, device code do Copilot); nos GET `authorize` de OpenAI, Gemini e xAI, parâmetro `urlOverrides` com o JSON do mapa. Os overrides ficam no fluxo pendente (memória; no Anthropic, a coluna nova `oauth_pending_flows.url_overrides`; no Copilot, por `device_code` por 20 min), valem para authorize, token, device code, Code Assist, console e OIDC do próprio fluxo e são gravados na conta criada antes da primeira descoberta de modelos. No Kiro, `urlOverrides.start_url` vence o parâmetro `startUrl` quando os dois vêm.
- **Permissão**: subscription exige owner ou admin da instância (403 para admin/member); o mesmo vale no início dos fluxos. `accountBaseUrl` no connect continua aceito (CLI e clientes antigos) e vira `urlOverrides.inference`; `urlOverrides` vence quando os dois nomeiam o slot.
- **Auditoria**: `provider.urls_changed` (categoria `audit`, nível `warning` para assinatura) com usuário, conta e ids dos slots, nunca valores. Não entrou na lista de eventos de gatilho (`WORKSPACE_TRIGGER_EVENTS`).
- **Formato por modelo do OpenCode**: com `models` próprio a listagem da conta vem da URL dela, mas a escolha de protocolo por modelo ainda consulta o catálogo global (ou a família do modelo).
- **Fora do escopo desta entrega**: ferramentas MCP e comandos da CLI `thinker` para os slots (a API REST já os expõe).
