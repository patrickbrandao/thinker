---
id: api-vertex
categoria: api
entidade: Google Vertex AI
agente: api-vertex
thinker_ids: [vertex]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# Google Vertex AI (acesso por API)

Especificação mantida pelo agente `api-vertex` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Thinker usa o Vertex só pelo formato nativo Gemini (`generateContent` / `streamGenerateContent`), com a chave em `x-goog-api-key`. Dois modos de endereçamento: **express** (chave sozinha, URL global sem projeto) e **projeto** (`project/location` guardado em `region`).
- A documentação do Google passou a chamar o produto de "Agent Platform" em partes (título da página de preços); a URL e os ids de API seguem os mesmos (não confirmado se há renomeação formal).
- Express só aceita 8 modelos (ver abaixo); o resto do catálogo atual exige modo projeto, que não tem UI no Thinker (G3).
- Aposentadorias: `gemini-2.5-*` em 2026-10-20 (já passou), `gemini-3.6-flash` em 2026-11-19 (G2).
- As lacunas de tradução do formato Gemini (thinking, `functionResponse`, `thoughtSignature`, `finishReason`) valem também para o vertex porque ele reutiliza `format: 'google'` (ver G1).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Generative AI docs | <https://cloud.google.com/vertex-ai/generative-ai/docs/overview> (redireciona para docs.cloud.google.com) | 2026-11-04 |
| Express mode | <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview> | 2026-11-04 |
| Modelos | <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/models> | 2026-11-04 |
| Versões e aposentadoria | <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions> | 2026-11-04 |
| Claude on Vertex | <https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude> | 2026-11-04 (página genérica, sem endpoints) |
| OpenAI-compatible API | <https://cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview> | 2026-11-04 |
| Pricing | <https://cloud.google.com/vertex-ai/generative-ai/pricing> | 2026-11-04 (conteúdo não extraído) |

## Contrato

### Endpoints e protocolos

- **Express:** `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:streamGenerateContent` (e `:generateContent`); sem projeto nem localização; a template `v1beta1` resolve para a mesma URL. Chave no header `x-goog-api-key`, ou query `key` se o cliente não puder enviar header. Fonte: express-mode, 2026-11-04.
- **Projeto:** `https://{loc}-aiplatform.googleapis.com/v1/projects/{p}/locations/{loc}/publishers/google/models/{model}:generateContent`; para `global` o host é `aiplatform.googleapis.com` sem prefixo. Pressupõe credenciais Google Cloud (OAuth/ADC ou chave vinculada ao projeto) (não confirmado para chave API em modo projeto).
- **OpenAI-compatível:** existe (`messages`, `tools`, `reasoning_effort`, `response_format`, `extra_body.google` para `thinking_config`/`cached_content`), mas a página não traz base URL nem diz que funciona em express. O comentário do código afirma que rejeita express com `RESOURCE_PROJECT_INVALID` (não confirmado).
- **Claude (parceiro):** disponível no Vertex (Fable 5.1/5, Opus 5.5…4.5, Sonnet 5.5…4.5, Haiku 5.5/4.5 segundo a página), mas a página não documenta rotas (`rawPredict`/`streamRawPredict`, `anthropic_version`) (não confirmado). Pertence também a `api-anthropic`.

### Modelos

- Listagem: o Thinker usa models.dev (`google-vertex`) e filtro por regex; não há endpoint de listagem validado nesta revisão (não confirmado).
- Modelos express (2026-11-04): cota dinâmica `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`; 10 RPM `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-image`, `gemini-2.5-flash-lite`. Modelos Live não são suportados.
- GA no catálogo: `gemini-4-argon` (+ `-cyber-permissive`, só allowlist), `gemini-3.8-flash`, `gemini-3.8-flash-cyber`, `gemini-3.8-live`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, família 2.5, modelos de imagem e TTS. Preview: `gemini-3.1-pro`, `gemini-3-flash`, Robotics ER 2, Omni (vídeo).
- Aposentadoria (página Model versions, 2026-11-04): `gemini-2.5-pro/flash/flash-lite` 2026-10-20; `gemini-live-2.5-flash-native-audio` 2026-12-13; `gemini-3.6-flash` 2026-11-19; `gemini-3.7-flash` 2027-01-28; `gemini-2.5-flash-image` 2027-03-15; `gemini-3.5-flash` 2027-05-19 ou depois; `gemini-3.8-flash` 2027-09-02 ou depois; `gemini-4-argon` 2027-10-13 ou depois. `gemini-2.0-flash(-lite)` e 1.5/1.0 já retirados.
- Contexto e saída máximos: não constam na página de modelos (não confirmado); `gemini-4-argon` cita saída longa de até 1M tokens.

### Capacidades

- Thinking com níveis configuráveis (Gemini 3+/4) e budgets (2.5); no formato nativo via `thinkingConfig`; no compat via `reasoning_effort` (`low|medium|high`).
- Ferramentas, visão, áudio, JSON schema, grounding (`web_search_options` no compat) segundo as docs; detalhes por modelo não verificados.
- Cache implícito/explícito: `cached_content` (compat via `extra_body.google`); semântica de cobrança não verificada.

### Streaming e uso

- Nativo: `:streamGenerateContent` transmite incrementalmente; `generateContent?alt=sse` responde um único evento (comportamento já tratado em `provider-endpoints.ts`).
- `usageMetadata` (prompt, candidates, cached, thoughts) igual ao Gemini API (não reconferido nesta revisão).

### Preços

- A página de preços foi lida mas o conteúdo de tabelas não foi extraído (não confirmado). Preços do Thinker vêm de models.dev/OpenRouter. Faixas de contexto longo e taxas de grounding por requisição precisam de checagem manual.
- Express: 90 dias gratuitos para contas `@gmail.com`, sem cobrança; ativar billing remove o limite.

### Limites e erros

- Express: 10 RPM nos modelos 2.5; cota dinâmica nos 3.x. Padrão de erro do Google (`error.status`: `RESOURCE_EXHAUSTED` para 429, `INVALID_ARGUMENT`, `NOT_FOUND` para modelo aposentado) (padrão geral, não reconferido).
- Chave express tem prefixo `AQ.` no Thinker (`packages/shared/src/providers.ts:117`); a doc não especifica o formato (não confirmado).

## Como o Thinker implementa hoje

- Base URL express `https://aiplatform.googleapis.com/v1beta1`, headers `Content-Type` e `x-goog-api-key`, caminhos `/publishers/google/models/{model}:generateContent|streamGenerateContent`, `format: 'google'` (`packages/backend/src/routing/proxy/provider-endpoints.ts:517-529`). Não usa a rota OpenAI-compatível (comentário em `:514`).
- Modo projeto: `parseVertexDeployment(region)` aceita `project/location` (`PROJECT_ID` 6-30 caracteres, `LOCATION` `global` ou `xx-yyyN`) e `getVertexBaseUrl` monta host regional ou global com `/v1/projects/{p}/locations/{loc}` (`packages/backend/src/routing/vertex-deployment.ts:20-61`); resolvido em `forward-endpoint-resolver.ts:129,151-154`. Valor malformado cai em express.
- Chave: prefixo `AQ.`, tamanho mínimo 40 (`packages/shared/src/providers.ts:110-121`).
- Descoberta: filtro de não-chat `^aqs-|nano-banana|deep-research|computer-use|lyria|imagen|veo|robotics|flash-lite-preview-MM-YYYY` (`provider-model-fetcher.service.ts:440`); alias de catálogo `google-vertex` (`models-dev-sync.service.ts:33`).
- UI: `vertex` no catálogo só com subtítulo, sem campos de região (`packages/frontend/src/services/providers.ts:189`); link de chave em `provider-api-key-urls.ts:4`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/vertex-deployment.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O vertex reutiliza o tradutor `format: 'google'`; valem para ele as lacunas do Gemini API: thinking não vira `thinkingConfig`, `functionResponse` sem id, `thoughtSignature` descartada, `finishReason` novos | providers | #421, #422, #423, #424 (mesma causa, `api-gemini`) | aberta |
| G2 | degradação | `gemini-2.5-*` aposentados em 2026-10-20, `gemini-3.6-flash` em 2026-11-19; Thinker não sinaliza ids aposentados | providers | #430 | aberta |
| G3 | degradação | Sem UI para projeto/localização; express cobre só 8 modelos, o resto do catálogo atual exige modo projeto | frontend-dev | #431 | aberta |
| G4 | oportunidade | Claude em Vertex (rawPredict/streamRawPredict) e rota OpenAI-compatível não são usados; docs não esclarecem endpoints | providers | — | aberta (investigar com conta real) |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa: contrato de express e projeto, lista de modelos e datas de aposentadoria, lacunas G1-G4 (issues #430, #431). Preços e endpoints do Claude não extraídos das páginas.
