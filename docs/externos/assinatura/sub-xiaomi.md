---
id: sub-xiaomi
categoria: assinatura
entidade: Xiaomi MiMo Token Plan
agente: sub-xiaomi
thinker_ids: [xiaomi]
revisado_em: 2026-11-03
versao_observada: docs mimo.mi.com 2026-11-03 (modelos V2.6; Token Plan Individual e Team)
---

# Xiaomi MiMo Token Plan (assinatura)

Especificação mantida pelo agente `sub-xiaomi` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Token Plan é uma assinatura em **Credits** (não em requisições) com quatro níveis (Lite, Standard, Pro, Max), edição **Individual** (chave `tp-...`) e **Team** (chave `ttp-...`, uma cota por assento). A chave é independente da chave pay-as-you-go (`sk-...`) e só vale com a base URL própria do plano (`token-plan-<cn|sgp|ams>.xiaomimimo.com`).
- Não há OAuth nem device code: a credencial é uma chave colada. Protocolos servidos: Chat Completions (`/v1`), Anthropic Messages (`/anthropic`) e Responses API (no plano, via guia do Codex; não confirmado para a base do plano).
- **Quebra em curso:** `mimo-v2.5-pro` e `mimo-v2.5` foram aposentados em 2026-10-21 10:00 (UTC+8) e os ids deixaram de funcionar; os modelos do plano agora são `mimo-v2.6-pro` e `mimo-v2.6-flash` (mais ASR e TTS). O `knownModels` do Thinker ainda lista a família V2/V2.5 (G1).
- Os termos proíbem uso fora de ferramentas de programação (scripts automatizados, backend de aplicativo próprio) com risco de bloqueio da chave; o Thinker não avisa (G4).
- Cotas: sem janela de 5 horas; é uma cota mensal de Credits com fator 0,8x na madrugada de Pequim. Não há endpoint público documentado para consultar o saldo (só o console).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Plataforma MiMo (SPA; a documentação redireciona para `mimo.mi.com`) | <https://platform.xiaomimimo.com> | 2026-11-03 |
| Token Plan Individual (planos, Credits, termos de uso, base URLs) | <https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription> | doc 2026-11-03 |
| Token Plan: acesso rápido (chaves, curl, FAQ) | <https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/quick-access> | doc 2026-11-03 |
| FAQ do Token Plan: uso e cota, validade, Team | <https://mimo.mi.com/docs/en-US/quick-start/faq/token-plan/Usage&Quota> (e `Validity&Expiry`, `Team-Benefits`) | 2026-10-20 / 2026-09-22 |
| Visão geral de ferramentas e guia do Claude Code | <https://mimo.mi.com/docs/en-US/tokenplan/integration/tools-overview>, `.../claudecode` | 2026-09-21 |
| Modelos, limites de contexto e RPM/TPM | <https://mimo.mi.com/docs/en-US/quick-start/summary/model> | 2026-10-20 |
| Depreciação de modelos | <https://mimo.mi.com/docs/en-US/updates/deprecate> | 2026-10-09 |
| Notas de modelos | <https://mimo.mi.com/docs/en-US/updates/model> | última entrada 2026-09-22 (V2.6) |
| Referência Chat Completions e Anthropic Messages | <https://mimo.mi.com/docs/en-US/api/chat/openai-api-post>, `.../anthropic-api-post` | doc 2026-11-03 |
| Códigos de erro | <https://mimo.mi.com/docs/en-US/api/guidance/error-codes> | 2026-07-15 |
| Termos de serviço (`/docs/terms/user-agreement`) | <https://mimo.mi.com/docs/terms/user-agreement> | não lido (não confirmado) |

Obs.: a documentação não tem tag de versão nem repositório de cliente oficial; a data "Update Time" de cada página é a referência. Não foi lido o guia do Codex (Responses API) nem a página de limites de taxa (`/docs/en-US/api/guidance/rate-limit`).

## Contrato

### Planos

Fonte: página de assinatura Individual, 2026-11-03.

| Nível | Mensal | Cota mensal | Anual | Cota anual | Rodadas (base `mimo-v2.6-flash`) |
|---|---|---|---|---|---|
| Lite | US$ 6 / ¥39 | 4,1 bi Credits | US$ 63,36 / ¥408 | 49,2 bi | ~200 |
| Standard | US$ 16 / ¥99 | 11 bi | US$ 168,96 / ¥1044 | 132 bi | ~1600 |
| Pro | US$ 50 / ¥329 | 38 bi | US$ 528 / ¥3468 | 456 bi | ~5600 |
| Max | US$ 100 / ¥659 | 82 bi | US$ 1056 / ¥6948 | 984 bi | ~12800 |

- Todos os níveis liberam os mesmos 6 modelos: `mimo-v2.6-pro`, `mimo-v2.6-flash`, `mimo-v2.5-asr`, `mimo-v2.5-tts`, `mimo-v2.5-tts-voiceclone`, `mimo-v2.5-tts-voicedesign`. Muda só a cota.
- `mimo-v2.6-pro-ultraspeed` está na tabela de modelos da API, mas **não** na lista do plano (serviço sob contato). Não confirmado se a chave do plano o aceita.
- Descontos: 12% na primeira compra mensal, 12% no anual com renovação automática. Sem reembolso. Upgrade pagando a diferença; sem downgrade.
- Edição **Team**: mesmo preço, compra por assento (Standard, Pro e Max: 11 bi, 38 bi e 82 bi Credits por assento por mês). A cota de cada assento reseta todo mês, inclusive em planos anuais, e não acumula. Esgotado o assento, só ele para (outros seguem). Dono também precisa de assento para chamar o modelo.
- Validade: um mês ou ano de calendário em UTC a partir da compra. Chave do plano morre com a expiração, com a remoção do assento ou com o cancelamento da conta Xiaomi.
- Contas chinesa e internacional são separadas: chaves e base URLs não são intercambiáveis, uso não se soma.

### Autenticação

- **Chave colada**, sem OAuth. Formatos: Individual `tp-xxxxx`, Team `ttp-xxxxx`, pay-as-you-go `sk-xxxxx` (os dois tipos de chave não se misturam; erro 401 documentado para essa mistura).
- Obtida em **Token Plan** no console (a doc diz que a base URL "é a exibida na página do Token Plan").
- Cabeçalho: a doc oferece duas formas, `api-key: <chave>` ou `Authorization: Bearer <chave>`. Os exemplos curl usam `api-key`; os guias de ferramentas (Claude Code) usam Bearer (`ANTHROPIC_AUTH_TOKEN`).
- Conta Xiaomi obrigatória; compra na China exige verificação de identidade (nome real).

### Endpoints

Fonte: acesso rápido e referência da API, 2026-11-03.

| Protocolo | Base | Caminho |
|---|---|---|
| OpenAI Chat Completions | `https://token-plan-<cn\|sgp\|ams>.xiaomimimo.com/v1` | `/chat/completions` |
| Anthropic Messages | `https://token-plan-<cn\|sgp\|ams>.xiaomimimo.com/anthropic` | `/v1/messages` |
| Pay-as-you-go (para comparação) | `https://api.xiaomimimo.com/v1` e `/anthropic` | idem |

- Clusters: China (`cn`), Singapura (`sgp`) e Europa (`ams`). O cluster depende da região da conta.
- Listagem de modelos: `GET <base>/v1/models` (formato OpenAI). Resposta real com a chave do plano não foi verificada (precisa de conta).
- Responses API: o aviso "MiMo Responses API is Live" e o guia do Codex indicam suporte no endpoint pay-as-you-go; se vale para a base do plano, não foi confirmado.

### Modelos

Fonte: página de modelos (atualizada em 2026-10-20) e depreciação.

| Modelo | Contexto | Saída máx. | RPM / TPM | Observações |
|---|---|---|---|---|
| `mimo-v2.6-pro` | 1M | 128K | 100 / 10M | Compreensão multimodal, thinking, function call, saída estruturada, busca na web |
| `mimo-v2.6-flash` | 1M | 128K | 100 / 10M | Mesmas capacidades; custo menor |
| `mimo-v2.6-pro-ultraspeed` | 1M | 128K | sob contato | Fora da lista do plano (ver acima) |
| `mimo-v2.5-asr` | 8K | 2K | 100 / 10K | Fala para texto; cobra por duração de áudio |
| `mimo-v2.5-tts`, `-voiceclone`, `-voicedesign` | 8K | 8K | 100 / 10M | Síntese de fala; grátis por tempo limitado, não consome Credits |

Aposentadorias (https://mimo.mi.com/docs/en-US/updates/deprecate):

- `mimo-v2.5-pro` e `mimo-v2.5`: substituição automática a partir de 2026-10-14, **ids removidos em 2026-10-21 10:00 (UTC+8)**. O erro devolvido depois disso não está documentado (não confirmado; espere 400 ou 404).
- `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2-flash`, `mimo-v2-tts`: removidos em 2026-06-30.
- Os modelos V2.6 aceitam imagem, vídeo e áudio (os V2.5 Pro só texto).

### Parâmetros e capacidades (V2.6)

- `thinking.type` (`enabled` | `disabled`), padrão **enabled** nos dois protocolos.
- No modo thinking, `temperature` e `top_p` são ignorados: valem 1.0 e 0.95 mesmo se enviados.
- `max_completion_tokens` (OpenAI) e `max_tokens` (Anthropic): padrão e teto 131072.
- `tool_choice` só aceita `auto`; qualquer outro valor é descartado pelo backend e o comportamento vira `auto`. `tools` só do tipo função (`custom` no Anthropic).
- Em conversa de várias voltas no modo thinking, o `reasoning_content` (OpenAI) ou o bloco `thinking` (Anthropic) deve voltar integralmente no histórico; a falta gera 400.
- Mensagem `developer` aceita no Chat Completions.
- `stop_reason` no Anthropic pode ser `content_filter` ou `repetition_truncation`, além dos usuais.
- `usage` no Anthropic traz `cache_read_input_tokens`.

### Identificação do cliente

Nenhuma exigência documentada: sem `User-Agent` obrigatório, sem cabeçalhos próprios, sem versão mínima, sem beta flags. Não há cliente oficial de código aberto identificado com tag; as ferramentas suportadas são usadas com a configuração padrão de base URL e chave (Claude Code, OpenCode, OpenClaw, Codex, Hermes, Kilo, Cline, Cherry Studio, Qwen Code, CodeBuddy e o próprio MiMo Code/Desktop). Detalhes de um cliente oficial (MiMo Code) não foram pesquisados.

### Clientes permitidos e termos

Fonte: assinatura Individual, "Package Usage", 2026-11-03.

- A cota do plano só pode ser usada em **ferramentas de programação** (a doc cita OpenClaw e OpenCode). É proibido usar a chave em chamadas de API para cenários claramente não ligados a código, como scripts automatizados e backends de aplicativos próprios.
- Chamadas fora do escopo contam como abuso: a plataforma se reserva o direito de suspender o serviço da assinatura e bloquear a chave.
- Um gateway que repassa tráfego de agentes de código é plausível; um gateway que serve aplicativos genéricos ou automações não é. Risco de ação na conta existe e é do mantenedor; o texto dos Termos de Serviço completos não foi lido.
- Erro 403 também cobre "chave restringida por controle de risco".

### Cotas e uso

- Modelo de **Credits**: tokens de entrada com cache (hit), entrada sem cache (miss) e saída têm coeficientes por modelo:

| Modelo | Entrada (cache hit) | Entrada (cache miss) | Saída |
|---|---|---|---|
| `mimo-v2.6-pro` | 2,5 | 300 | 600 |
| `mimo-v2.6-flash` | 2 | 100 | 200 |

- `mimo-v2.5-asr`: 30 M Credits por hora de áudio de entrada (arredondado ao segundo). TTS não consome.
- Fator **0,8x** entre 00:00 e 08:00 de Pequim (16:00 a 24:00 UTC).
- Esgotada a cota mensal, o serviço é suspenso: não há consumo de bônus nem de saldo da conta, e não há reposição automática. A janela é mensal, sem janela curta de 5 horas.
- Consulta de saldo: barra de progresso na página do Token Plan do console e avisos por SMS e e-mail em 50%, 90% e 100%. **Nenhum endpoint ou cabeçalho de uso documentado** (não confirmado que não exista).
- RPM e TPM são por conta e por modelo, somando todas as chaves da conta.

### Erros

Fonte: códigos de erro, 2026-07-15.

| Código | Significado | Observação para o gateway |
|---|---|---|
| 400 | Formato inválido, modelo inexistente, `reasoning_content` faltando em conversa thinking | Provável também para ids aposentados (não confirmado) |
| 401 | Chave ausente ou inválida; mistura de chave Token Plan com pay-as-you-go ou base URL errada | Reconectar / checar base URL |
| 402 | Saldo insuficiente | Só pay-as-you-go |
| 403 | Região sem serviço ou chave bloqueada por controle de risco | Não repetir |
| 404 | Endpoint ou modelo sem suporte a entrada de imagem | |
| 421 | Moderação de conteúdo | Não repetir |
| 429 | Requisições frequentes **ou** cota do Token Plan esgotada | Os dois casos usam o mesmo código; sem corpo distinto documentado |
| 500, 503 | Erro do servidor, sobrecarga | Repetível |

## Como o Thinker implementa hoje

Valores conferidos no código da worktree `onda2` em 2026-11-03.

- **Autenticação:** chave colada (`subscriptionAuthMode: 'token'`), validada no dashboard com prefixo `tp-` e mínimo de 10 caracteres (`packages/shared/src/subscription/configs.ts:140-157`, `packages/frontend/src/services/provider-utils.ts:38-48`, `:61-67`). Chaves Team (`ttp-`) não passam nessa validação (G3).
- **Envio:** `Authorization: Bearer <chave>` e `Content-Type: application/json` (`packages/backend/src/routing/proxy/provider-endpoints.ts:86-89`), formato OpenAI, caminho Chat Completions, `stream_options` de uso (`provider-endpoints.ts:425-431`). Nunca usa o protocolo Anthropic nem a Responses API do plano.
- **Base URL:** `getXiaomiTokenPlanBaseUrl(region)` com `cn`, `sgp` e `ams` (`packages/backend/src/routing/xiaomi-region.ts:3-8`), padrão `cn`; o gateway acrescenta `/v1`. A região escolhida vira `customEndpoint` em `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts:178-186` e na descoberta de modelos em `packages/backend/src/model-discovery/model-discovery.service.ts:221-226`. Validação do campo `region` em `packages/backend/src/routing/subscription-region.ts:18-22`; o frontend oferece as três regiões (`packages/frontend/src/services/providers.ts:406-424`).
- **Prefixos de modelo:** `xiaomi/`, `mimo/` e `xiaomi-mimo/` são removidos antes do envio na assinatura (`forward-endpoint-resolver.ts:39`, `:121-126`).
- **Descoberta de modelos:** `GET <base>/v1/models` com Bearer (`provider-model-fetcher.service.ts:61`, `:975-979`); aceita só ids que começam com `mimo-v` e descarta `asr`/`tts` (`:365-372`, `:460-461`). A janela de contexto vem de um mapa fixo com cinco ids antigos e o restante recebe o valor padrão (`:357-371`).
- **Lista curada (`knownModels`):** `mimo-v2.5-pro`, `mimo-v2-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`, correspondência exata, contexto máximo 1048576, cache de prompt sim (`packages/shared/src/subscription/configs.ts:144-157`). Usada como fallback quando `/models` volta vazio e como filtro dos modelos que a assinatura concede (`model-discovery.service.ts:288-297`). O subtítulo do dashboard ainda diz "MiMo V2.5 Pro, V2.5, Flash" (`packages/frontend/src/services/providers.ts:408`).
- **Raciocínio:** a família `mimo` é tratada como modelo com `reasoning_content` e o campo é preservado no histórico quando o endpoint aceita (`packages/backend/src/routing/proxy/reasoning-format.ts:42`).
- **Links:** chaves em `https://platform.xiaomimimo.com/token-plan` e `/console/api-keys` (`packages/frontend/src/services/provider-api-key-urls.ts:26`, `:50`). O site responde 200 (a documentação foi migrada para `mimo.mi.com`).
- **Preço:** a assinatura trata o custo como zero; não há contabilidade em Credits nem tabela de preços de assinatura.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/providers.ts` (linha 297, provedor pay-as-you-go `xiaomi`)
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts` (linha 22)
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/backend/src/routing/subscription-region.ts`
- `packages/backend/src/routing/xiaomi-region.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-utils.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/shared/src/provider-inference.ts` (linha 19, prefixo `mimo-v`)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | quebra | `knownModels` e subtítulo do dashboard listam só modelos aposentados (`mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-*`); `mimo-v2.6-pro` e `mimo-v2.6-flash` faltam e o filtro exato os esconde. Pedidos aos ids antigos falham desde 2026-10-21. Arquivos: `configs.ts:144-150`, `providers.ts:408` (frontend). Ajuste: trocar por `mimo-v2.6-pro` e `mimo-v2.6-flash` (e considerar o ultraspeed). | providers | [#361](https://github.com/patrickbrandao/thinker/issues/361) | resolvida (knownModels mimo-v2.6-pro/flash) |
| G2 | degradação | Mapa de contexto (`provider-model-fetcher.service.ts:357-363`) e `maxContextWindow` (`configs.ts:153`) não conhecem V2.6: os ids caem no padrão. V2.6 tem 1M de contexto e 128K de saída; o mapa também mantém `mimo-v2-omni` e `mimo-v2-flash` em 262144 (aposentados). | providers | [#362](https://github.com/patrickbrandao/thinker/issues/362) | resolvida (contexto 1M dos V2.6) |
| G3 | degradação | Chaves da edição Team (`ttp-...`) são recusadas pela validação do dashboard, que exige prefixo `tp-` (`provider-utils.ts:42`, `:61-67`, `configs.ts:145`). Ajuste: aceitar `tp-` e `ttp-`. | frontend-dev | [#363](https://github.com/patrickbrandao/thinker/issues/363) | resolvida (prefixo ttp- aceito) |
| G4 | degradação | Os termos do plano proíbem scripts automatizados e backends de aplicativos próprios e preveem bloqueio da chave; o Thinker não avisa ao conectar o Token Plan nem sobre 403 de controle de risco. Mesmo padrão de #347 e #360. | frontend-dev | [#364](https://github.com/patrickbrandao/thinker/issues/364) | resolvida (aviso de termos fixo no modal de conexão e na doc) |
| G5 | oportunidade | O plano serve o protocolo Anthropic (`/anthropic/v1/messages`) e o MiMo documenta Claude Code sobre ele; o Thinker só usa Chat Completions. Usar Messages preservaria blocos `thinking` e `cache_read_input_tokens` nativos. Verificar também a Responses API no endpoint do plano. | providers | — | aberta |
| G6 | oportunidade | Uso em Credits (coeficientes por modelo, fator 0,8x na madrugada de Pequim) não é refletido no custo nem no medidor; sem endpoint público de saldo (só console). Um contador local aproximado em Credits seria possível. 429 do plano (cota esgotada) usa o mesmo código do limite de taxa. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa. Documentação lida em `mimo.mi.com` (planos Individual e Team, FAQ, modelos, depreciação, referências OpenAI e Anthropic, erros). Descobertas: aposentadoria de V2.5 em 2026-10-21 e modelos V2.6 (G1, G2), chave Team `ttp-` (G3), cláusula de uso apenas em ferramentas de programação (G4). Não lidos: Termos de Serviço completos, guia do Codex/Responses, limites de taxa.
