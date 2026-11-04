---
id: sub-moonshot
categoria: assinatura
entidade: Kimi Coding Plan
agente: sub-moonshot
thinker_ids: [moonshot]
revisado_em: 2026-11-03
versao_observada: kimi-code 2.4.1 (commit 444c609 de main), docs Kimi Code 2026-11-03
---

# Kimi Coding Plan (assinatura)

Especificação mantida pelo agente `sub-moonshot` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O cliente oficial mudou: o `kimi-cli` (Python) foi **arquivado** em 2026-09-22 (v1.52.0, última) e o sucessor é o **Kimi Code CLI** (`MoonshotAI/kimi-code`, TypeScript, v2.4.1 estável em 2026-10-30). Quem for espelhar o cliente oficial deve olhar o `kimi-code`.
- O Thinker usa a chave de API do Kimi Code Console (colada) contra o endpoint compatível com Anthropic (`https://api.kimi.com/coding/v1/messages`). A doc lista isso como uso suportado para ferramentas de terceiros (Claude Code, OpenCode, Codex, Hermes Agent).
- O catálogo do plano ganhou `k3.1-pro` e `k3.1-pro-highspeed`; `kimi-for-coding` agora é o "K2.8 Preview" com contexto de até 1M. O Thinker conhece só 4 ids e filtra por correspondência exata (G1, G2).
- Termos: alterar o User-Agent de uma ferramenta não oficial conta como violação e pode suspender benefícios. O Thinker não envia UA próprio nem imita o Kimi CLI; risco aparentemente baixo, mas não verificado ao vivo (G4).
- Existe `GET {base}/usages` para ler cotas (5h, 7d, mês); o Thinker não usa (G3).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Kimi Code console | <https://www.kimi.com/code/console> | não aberto (exige login); chaves: até 5 por conta, exibidas uma vez (segundo a doc) |
| Docs Kimi Code (modelos, endpoints, terceiros) | <https://www.kimi.com/code/docs/en/kimi-code/models> | 2026-11-03 |
| Kimi Code CLI (sucessor, TypeScript) | <https://github.com/MoonshotAI/kimi-code> | `@moonshot-ai/kimi-code@2.4.1`, `main` @ 444c609 |
| Kimi CLI (arquivado) | <https://github.com/MoonshotAI/kimi-cli> | v1.52.0 (2026-09-22), commit 9ab1286 |

## Contrato

### Planos

Fonte: docs Kimi Code, 2026-11-03. Preços não constam nas páginas lidas (ficam em "Membership Benefits", não lida).

- Nomes novos: Plus, Pro. Nomes legados: Andante, Moderato, Allegretto.
- Acesso por modelo (planos novo / legado):

| Model id | Nome | Contexto | Thinking | Planos |
|---|---|---|---|---|
| `k3.1-pro` | K3.1 Pro | até 1M (1M em Pro+ / Allegretto+) | sempre ligado | Plus+ / Moderato+ |
| `k3.1-pro-highspeed` | K3.1 Pro Highspeed | até 1M | sempre ligado | Pro+ / Allegretto+ (~2x cota, 2-3x mais rápido) |
| `k3` | K3 | até 1M (1M em Pro+ / Allegretto+) | opcional | Plus+ / Moderato+ |
| `k3-256k` | K3 (256K) | 256K | opcional | Plus+ / Moderato+ (só imagem, sem vídeo) |
| `kimi-for-coding` | K2.8 Preview | até 1M | opcional | Plus+ / Andante+ |
| `kimi-for-coding-highspeed` | K2.7 Code Highspeed | 256K | não ajustável | Pro+ / Allegretto+ (~3x cota, ~6x mais rápido) |

- `k3` com 1M consome ~2x a cota de `k3-256k`.
- Um id errado cai silenciosamente em K2.8 Preview sem thinking (doc).

### Autenticação

- Chave de API criada no Console (até 5 por conta). É o que o Thinker usa (`subscriptionAuthMode: 'token'`).
- O cliente oficial usa **OAuth device flow** em `https://auth.kimi.com` (há host regional para overseas, ver `region.ts`): `POST /api/oauth/device_authorization` (form `client_id`), `POST /api/oauth/token` com `grant_type=urn:ietf:params:oauth:grant-type:device_code` e depois `grant_type=refresh_token`. `client_id` público do cliente: `17e5f671-d194-4dfb-9706-5516cb48c098` (compartilhado entre regiões). Fonte: `packages/oauth/src/oauth.ts` e `constants.ts` do kimi-code 2.4.1; idem `kimi-cli` 1.52.0 `auth/oauth.py`. Refresh preventivo em ~50% da vida do token (mínimo 5 min) no cliente antigo. O Thinker **não** implementa esse fluxo.
- Chaves do Console vão como `Authorization: Bearer` (OpenAI) ou `x-api-key` (Anthropic); o Thinker usa `x-api-key`.

### Endpoints

Fonte: docs Kimi Code 2026-11-03; `managed-usage.ts` e `region.ts` do kimi-code.

| Protocolo | China (.com) | Overseas (.ai) |
|---|---|---|
| OpenAI (Chat Completions / Responses) | `https://api.kimi.com/coding/v1` | `https://api.kimi.ai/coding/v1` |
| Anthropic Messages | `https://api.kimi.com/coding/` (`/v1/messages`) | `https://api.kimi.ai/coding/` |

- O cliente oficial usa Anthropic via `/v1/messages?beta=true` com `thinking: { type: 'adaptive' }` para modelos declarados `protocol: anthropic` (comentário em `managed-kimi-code.ts` ~599-622).
- Lista de modelos: `GET {base}/models` (`Authorization: Bearer`), resposta `{ data: [...] }` com id, contexto e capacidades (`fetchManagedKimiCodeModels`). 401/402/403 são tratados como erro de auth/plano.
- `k3.1-pro`: requisição com thinking desligado retorna HTTP 400. Esforço: `ultra`/`max`/`xhigh` mapeiam para `max`; `high`/`medium` para `high`; `low`/`minimum`/`light` para `low`; valor desconhecido retorna 400. Trocar de modelo ou esforço invalida o cache de contexto. A doc recomenda o formato nativo (Responses) para K3.1 Pro, pois tradução por proxy pode mudar o comportamento.

### Identificação do cliente

- Cliente oficial atual: Kimi Code CLI. Envia `User-Agent` de produto e `X-Msh-Platform` (`kimi_code_cli`), `X-Msh-Version`, `X-Msh-Device-Name`, `X-Msh-Device-Model`, `X-Msh-Os-Version`, `X-Msh-Device-Id` (UUID persistido). O `kimi-cli` antigo enviava `User-Agent: KimiCLI/<versão>` e `X-Msh-Platform: kimi_cli`. Existe `KIMI_CODE_CUSTOM_HEADERS` para cabeçalhos extras.
- Nenhuma fonte primária lida exige esses cabeçalhos em chaves de API de terceiros; a doc de ferramentas de terceiros só pede Base URL, chave e id de modelo. Se o backend rejeita UA genérico: (não confirmado).
- Versão a espelhar, se um dia for preciso: Kimi Code CLI 2.4.1.

### Clientes permitidos e termos

- A doc lista Claude Code, OpenCode, Codex e Hermes Agent como ferramentas de terceiros suportadas com chave de API.
- Regra explícita: manter o identificador real da ferramenta; **alterar o User-Agent conta como violação e pode suspender os benefícios da assinatura**. Se um gateway que não repassa o UA do cliente é visto como violação: (não confirmado).
- Nas páginas lidas não há regra sobre compartilhamento de chave além do limite de 5 chaves.

### Cotas e uso

- `GET {base}/usages` com `Authorization: Bearer <chave>` (kimi-cli 1.52.0 `ui/shell/usage.py`; kimi-code `managed-usage.ts`). No kimi-code a resposta tem `limit5h`, `limit7d`, `monthTotal`, `monthCode`, cada um `{ usedRatio, resetAt? }`; o cliente antigo lia `usage` e `limits[]` com `used/limit/remaining` e `window.duration/timeUnit`. O formato mudou entre as versões: tratar de forma tolerante.
- O kimi-code 2.x também consulta saldo "booster wallet" (uso extra cobrado).
- Janelas observadas no código: 5 horas, 7 dias, mês. O texto público de planos não detalha (não confirmado).

### Erros

- `/models`: 401, 402, 403 viram erro de auth/plano no cliente oficial.
- `k3.1-pro` sem thinking e esforço inválido: 400 (doc).
- O CLI antigo mostrava todo 403 como "quota exceeded" por engano (corrigido na 1.45.0); não assumir que 403 significa cota.
- Códigos de cota excedida (429/402) não foram confirmados em fonte primária (não confirmado).

## Como o Thinker implementa hoje

- Config da assinatura: label "Kimi Coding Plan", auth por token colado, `knownModels: ['k3','k3-256k','kimi-for-coding','kimi-for-coding-highspeed']` com `knownModelsMatch: 'exact'`; janelas: padrão 262144, `k3` 1048576, `k3-256k` 262144; cache de prompt sim, batching não (`packages/shared/src/subscription/configs.ts:172-193`).
- Endpoint `moonshot-subscription`: base `https://api.kimi.com/coding`, formato Anthropic, `POST /v1/messages`, cabeçalhos `x-api-key`, `Content-Type`, `anthropic-version: 2023-06-01`, `skipSubscriptionIdentity: true` (`packages/backend/src/routing/proxy/provider-endpoints.ts:187` e `:439-445`; cabeçalhos em `:172-176`). Sem `?beta=true`, sem User-Agent próprio nem repasse do UA do cliente (o UA só é lido para atribuição em `packages/backend/src/routing/proxy/caller-classifier.ts:36`).
- Roteamento assinatura: `moonshot` -> `moonshot-subscription` (`packages/backend/src/common/constants/subscription-clients.ts:23`).
- Listagem de modelos de assinatura: retorna `[]` e usa a lista fixa (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:1101-1104`). O `/models` do plano não é consultado.
- Inferência de provedor por id: `^kimi-|^moonshot-|^k3(-|$)` -> `moonshot` (`packages/shared/src/provider-inference.ts:15-17`); `k3.1-pro` não casa (o `.` não é `-` nem fim).
- Não há leitura de `/usages` nem fluxo OAuth do Kimi.
- A chave de API `moonshot` (não assinatura) usa `https://api.moonshot.ai` em OpenAI (`provider-endpoints.ts:432-438`), fora do escopo; ver `api-moonshot`.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/shared/src/provider-inference.ts`

Outros arquivos que citam `moonshot`: `model-capabilities.ts`, `reasoning-format.ts`, `provider-param-spec.service.ts`, `ProviderIcon.tsx`, `services/providers.ts`, `packages/shared/src/providers.ts`.

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `k3.1-pro` e `k3.1-pro-highspeed` (novos) fora de `knownModels` (filtro exato os esconde) e sem casar na inferência de provedor; K3.1 Pro exige thinking ligado (400 sem). Sugestão: adicionar ids, janelas e inferência `k3.1-`, não desligar thinking. | providers | #342 | aberta |
| G2 | degradação | `kimi-for-coding` agora é K2.8 Preview com contexto de até 1M; Thinker assume 262144. Sugestão: confirmar `context_length` real em `/models` com conta e ajustar `modelContextWindows`. | providers | #344 | aberta |
| G3 | oportunidade | Ler cotas (`/usages`: 5h, 7d, mês) para exibir uso restante. | backend-dev | sem issue (oportunidade) | aberta |
| G4 | oportunidade | Região overseas `api.kimi.ai` não suportada (base fixa em `.com`); Thinker não envia UA de produto, enquanto os termos exigem manter o identificador real. Verificar com conta real se chaves globais funcionam em `.com` e se UA genérico é aceito. | providers | sem issue (oportunidade) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fontes: docs Kimi Code (models, home), `kimi-code` 2.4.1 e `kimi-cli` 1.52.0 (arquivado). Descobertos K3.1 Pro, contexto 1M de `kimi-for-coding`, endpoint overseas, `/usages` e regra de UA nos termos. Lacunas G1-G4.
