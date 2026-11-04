---
id: sub-commandcode
categoria: assinatura
entidade: Command Code
agente: sub-commandcode
thinker_ids: [commandcode]
revisado_em: 2026-11-03
versao_observada: docs 2026-11-03 (CLI command-code 1.88.2)
---

# Command Code (assinatura)

Especificação mantida pelo agente `sub-commandcode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Command Code é um agente de código (CLI `cmd`, app desktop) com planos de assinatura que dão créditos mensais. A mesma chave de API autentica o CLI e a **Provider API**, que expõe os modelos por três protocolos: Chat Completions, Responses e Anthropic Messages.
- Não há OAuth nem identificação de cliente: basta `Authorization: Bearer <chave>`. A chave é criada no Studio. Todo plano, exceto o Go, tem acesso à API.
- O Thinker já cobre o essencial (base URL, descoberta de modelos, roteamento dos modelos `claude-*` para `/messages`). A lacuna aberta é de texto: o aviso diz "Pro ou superior", mas só o Go é excluído.
- Confiança alta no contrato da API (doc oficial mais `GET /models` consultado ao vivo, sem chave). Média nos termos de uso e no formato da chave.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Command Code studio | <https://commandcode.ai/studio> | não lido (exige login) |
| Docs: Provider API | <https://commandcode.ai/docs/provider> | 2026-11-03 |
| Docs: preços e limites | <https://commandcode.ai/docs/resources/pricing-limits> | 2026-11-03 |
| Docs: limites de uso | <https://commandcode.ai/docs/resources/usage-limits> | 2026-11-03 |
| Docs: modelos | <https://commandcode.ai/docs/reference/cli/models> | 2026-11-03 |
| Docs: planos Go e Pro | <https://commandcode.ai/docs/plans/go>, <https://commandcode.ai/docs/plans/pro> | 2026-11-03 |
| Docs: erros | <https://commandcode.ai/docs/troubleshooting/errors> | 2026-11-03 |
| Termos de serviço | <https://commandcode.ai/terms> | 2026-11-03 |
| Changelog | <https://commandcode.ai/changelog> | CLI 1.88.0 (2026-10-23) |
| Catálogo público de modelos | <https://api.commandcode.ai/provider/v1/models> | 2026-11-03 (96 modelos) |
| Pacote npm do CLI | <https://www.npmjs.com/package/command-code> | 1.88.2 (2026-10-29), código proprietário e não lido |
| Repositório | <https://github.com/CommandCodeAI/command-code> | não lido |

## Contrato

### Planos

Fonte: pricing-limits e páginas de plano, 2026-11-03. Créditos em US$.

| Plano | Preço/mês | Créditos/mês | Janela 5 h | Janela semanal | API |
|---|---|---|---|---|---|
| Go | 1 | 10 | 2 a 3 (a página de preços e a de limites divergem) | 5 a 6 (idem) | **não** |
| GOAT | 10 | até 100 | até 20 | até 50 | sim |
| Pro | 20 | até 110 | até 22 | até 55 | sim |
| Max 10x | 100 | 150 | 45 | 90 | sim |
| Max 20x | 200 | 300 | 90 | 180 | sim |
| Team Pro | 40 por assento | 40 | 12 | 24 | sim |
| Provider | 15 (mais taxa de 1,01) | pré-pago, sem expiração | sem janelas | sem janelas | sim |
| Enterprise | 5.000+ | pool customizado | sem limite | sem limite | (não confirmado) |

- Nos planos Go, GOAT e Pro os créditos são "unidades de valor de uso": modelos premium têm cota própria por modelo (por exemplo, até 20 por modelo premium no Pro). Claude Opus, Claude Fable e Fugu Ultra exigem Max ou créditos pré-pagos.
- Modelos gratuitos (sufixo `:free`, `-free`) seguem funcionando quando o limite acaba.

### Autenticação

- Chave de API criada em `commandcode.ai/settings/keys` (Studio). A mesma chave serve ao CLI e à API.
- Cabeçalho: `Authorization: Bearer <chave>` em todas as rotas. Em `/messages` também vale `x-api-key` (para o SDK da Anthropic).
- Não há OAuth, device code, refresh nem rotação. O login do CLI é por navegador, mas a chave é independente.
- Formato da chave: a doc não documenta prefixo nem tamanho. O Thinker assume `user_` e no mínimo 50 caracteres (`packages/shared/src/providers.ts:244`); isso é não confirmado.

### Endpoints

Base URL: `https://api.commandcode.ai/provider/v1`.

| Método e rota | Uso |
|---|---|
| `POST /chat/completions` | Chat Completions (modelos abertos e GPT) |
| `POST /responses` | Responses (modelos abertos e GPT; Claude fica só em `/messages`) |
| `POST /messages` | Anthropic Messages (modelos Claude) |
| `GET /models` | lista ao vivo; **não exige chave** (consultado sem autenticação em 2026-11-03) |
| `POST /systemone` | modelos de decisão `typesafe/jev` (retornam probabilidades, sem stream) |

- `GET /models` retorna `{object:"list", data:[{id, object, created, owned_by:"command-code", name, context_length, supported_endpoints}]}`. Não há preços nem modalidades. Em 2026-11-03: 96 modelos; 72 com `/chat/completions` e `/responses`, 13 só com `/chat/completions`, 11 só com `/messages` (todos `claude-*`).
- IDs: modelos abertos usam `vendor/nome` (`deepseek/deepseek-v4-flash`, padrão do CLI); Claude e GPT não têm prefixo (`claude-sonnet-5-5`, `gpt-6.1-sol`). O id ao vivo do Haiku 4.5 é `claude-haiku-4-5-20251001` (a doc de modelos lista `claude-haiku-4-5`).
- Contexto: 1.000.000 para os Claude atuais e vários abertos, 1.050.000 para GPT-6, 200.000 para Haiku 4.5.
- Stream com `stream: true`; o uso vem ao final de todo stream.
- Entrada aceita texto e imagem; áudio, arquivo e documento são rejeitados. Corpo máximo de 32 MiB (413).
- Responses: ferramentas `function` e `custom` rodam no cliente, ferramentas embutidas como `web_search` seguem ao upstream, e `type: "mcp"` remoto é rejeitado.
- Retenção zero: cabeçalho `x-cmd-zdr: 1` (422 `cmd_zdr_no_providers` se não houver upstream ZDR; só aceita ferramentas executadas no cliente).

### Identificação do cliente

Nenhuma exigida: sem user agent especial, sem cabeçalho de versão, sem beta flag. A doc afirma que qualquer cliente compatível com OpenAI ou Anthropic funciona ("sem lock-in"). O CLI `command-code` está na 1.88.2, mas o Thinker não precisa espelhá-lo.

### Clientes permitidos e termos

- A doc da Provider API convida o uso por clientes e agentes de terceiros; os termos (<https://commandcode.ai/terms>) não citam chaves, proxies nem gateways.
- Os termos proíbem: revender, sublicenciar ou usar o serviço em benefício de terceiros; mais de uma conta por pessoa (ban permanente); scripts para múltiplas contas. Os créditos de assinatura valem no máximo 1:1 com o custo de API.
- Risco para o Thinker: uso pessoal de uma chave própria é coerente com a doc; expor o gateway a terceiros com a mesma chave cairia na proibição de revenda (interpretação, não confirmado com o fornecedor).

### Cotas e uso

- Duas janelas rolantes por plano de assinatura (5 horas e 7 dias), medidas em valor de crédito, e um teto mensal. A janela começa na primeira requisição e reinicia depois de 5 h ou 7 d.
- Créditos extras (pré-pagos) não entram nas janelas, rolam e não expiram; ao ultrapassar uma janela, são gastos primeiro.
- Leitura do uso restante: apenas `/usage` no CLI e a página Usage do Studio. **Não há endpoint nem cabeçalho documentado.**

### Erros

Fonte: doc da Provider API.

| HTTP | Código | Significado | Ação |
|---|---|---|---|
| 400 | `unsupported_model`, `invalid_request_error` | modelo desconhecido, rota errada ou corpo inválido | não repetir |
| 401 | `authentication_error` | chave ausente ou inválida | reautenticar |
| 403 | `upgrade_required` | plano Go sem acesso à API | trocar de plano |
| 403 | `model_region_unavailable` | modelo indisponível na região | outro modelo |
| 403 | `content_policy_refused`, `upstream_refused` | recusado, sem cobrança | não repetir |
| 413 | `request_too_large` | corpo acima de 32 MiB | reduzir |
| 422 | `cmd_zdr_no_providers` | ZDR pedido sem upstream ZDR | |
| 429 | `rate_limit_error` | limite do upstream | repetir com backoff |
| 502 | `model_temporarily_unavailable`, `upstream_unavailable` | problema do lado deles, sem cobrança | repetir ou fallback |
| 5xx | `server_error`, `api_error` | falha do upstream | repetir com backoff |

Limite de janela estourado: a requisição é recusada com mensagem que cita a janela e a hora de reinício (o código HTTP exato não está documentado; (não confirmado) se é 429 ou 403). Outras páginas de erro individuais não foram lidas.

## Como o Thinker implementa hoje

- Registro: id `commandcode`, aliases `command-code`, `command code`, `cmd`, chave `user_...`, mínimo 50 caracteres (`packages/shared/src/providers.ts:237-248`).
- Assinatura: modo `token`, rótulo "Command Code subscription", contexto máximo 1.000.000, sem cache de prompt nem batching (`packages/shared/src/subscription/configs.ts:345-355`). Sem lista fixa; a lista é dinâmica.
- Base URL `https://api.commandcode.ai/provider` (`packages/backend/src/routing/proxy/provider-endpoints.ts:186`).
  - `commandcode`: OpenAI, `Authorization: Bearer`, caminho `/v1/chat/completions` (`provider-endpoints.ts:309-315`).
  - `commandcode-anthropic`: `/v1/messages` com `x-api-key` e `anthropic-version: 2023-06-01`, sem identidade de assinatura (`provider-endpoints.ts:337-343`).
- Seleção do endpoint: modelo cujo nome (sem o prefixo `commandcode/`) começa com `claude-` vai para `commandcode-anthropic`; o resto para chat completions (`packages/backend/src/routing/proxy/provider-client.ts:637-644`). O prefixo `commandcode/` é removido antes do envio (`provider-client.ts:337-339`). Não consulta `supported_endpoints`.
- Descoberta: `GET https://api.commandcode.ai/provider/v1/models` com Bearer, id vira `commandcode/<id>`, nome, `context_length`, sem preço (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:59,176,333-339,887-891`). Fica no conjunto de provedores com endpoint de stream (`packages/backend/src/model-discovery/model-capabilities.ts:16`).
- Inferência de provedor pelo prefixo `commandcode/` (`packages/shared/src/provider-inference.ts:23`).
- UI: link de chave `https://commandcode.ai/studio` (`packages/frontend/src/services/provider-api-key-urls.ts:43`); aviso "Requires Command Code Pro or higher" (`packages/frontend/src/i18n/locales/en/providerSetup.ts:274`, `pt-BR/providerSetup.ts:282`, `packages/frontend/src/services/providers.ts:309`).
- Docs: `docs/providers/subscription-based-providers.md:15,54-56`.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/frontend/src/i18n/locales/{en,pt-BR}/providerSetup.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A doc diz que só o Go não tem API (GOAT, Pro, Max, Team e Provider têm). O Thinker avisa "Pro ou superior" na UI e na doc, afastando GOAT, Provider e Team. Arquivos: `providerSetup.ts` (en e pt-BR), `providers.ts:309`, `docs/providers/subscription-based-providers.md:56`. Trocar o texto por "plano com acesso à API (qualquer um, exceto Go)". | `frontend-dev` | [#328](https://github.com/patrickbrandao/thinker/issues/328) | aberta |
| G2 | oportunidade | `x-cmd-zdr: 1` (retenção zero) não é enviado nem exposto como opção por provedor. Útil para quem quer privacidade; só aceita ferramentas executadas no cliente. | `providers` | — | aberta |
| G3 | oportunidade | Modelos GPT e abertos aceitam `/responses`; o Thinker só usa `/chat/completions` e decide por prefixo `claude-`, ignorando `supported_endpoints` do `/models`. Hoje funciona (11 modelos só `/messages`, 13 só chat), mas um modelo novo com outro conjunto de rotas quebraria. Ler `supported_endpoints` seria mais robusto. | `providers` | — | aberta |
| G4 | oportunidade | Janelas de 5 h e semanal só são visíveis no CLI e no Studio; sem endpoint, o medidor de uso do Thinker não pode refletir o plano. Reavaliar se a Command Code publicar um. | `backend-dev` | — | aberta |
| G5 | oportunidade | Validação da chave assume prefixo `user_` e 50 caracteres, sem confirmação na doc. Se o formato mudar, chaves válidas seriam recusadas. Conferir com uma chave real; considerar tornar a validação branda. | `providers` | — | aberta (precisa de conferência ao vivo) |

## Histórico

- 2026-11-03: primeira revisão completa (docs oficiais, `GET /models` público, termos, changelog; CLI 1.88.2). Contrato preenchido; G1 aberta com issue #328; G2 a G5 como oportunidade, sem issue.
