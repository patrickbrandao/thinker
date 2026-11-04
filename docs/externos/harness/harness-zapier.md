---
id: harness-zapier
categoria: harness
entidade: Zapier
agente: harness-zapier
thinker_ids: [zapier]
revisado_em: 2026-11-03
versao_observada: help center Zapier 2026-11-03 (artigos atualizados entre 2026-07 e 2026-10); Zapier é SaaS, sem versão
---

# Zapier (harness)

Especificação mantida pelo agente `harness-zapier` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: o harness é o **Zapier** (zapier.com, SaaS de automação). Identidade confirmada com confiança alta (a fonte semente `help.zapier.com` está correta). Zapier é **fechado e hospedado**: não há repositório do cliente; a verdade é o help center e os docs da Plataforma (`docs.zapier.com`). Nada foi verificado em código-fonte; tudo abaixo é de documentação (`(não confirmado)` onde só há relato de comunidade).
- **Nenhum app de IA nativo do Zapier aceita Base URL personalizada.** O app ChatGPT (OpenAI) conecta só com API key (+ Organization ID opcional); o AI by Zapier tem BYOK apenas para OpenAI, Anthropic, Google, Azure OpenAI e Bedrock; os apps diretos (OpenRouter, Groq, DeepSeek, Mistral, xAI etc.) usam a própria chave do provedor. Logo, o Zapier **não é um cliente OpenAI-compatível apontável para um gateway** da forma de n8n ou Open WebUI.
- O caminho viável é **Webhooks by Zapier > Custom Request** (POST com URL, cabeçalhos e corpo JSON livres) para `POST /v1/chat/completions` do Thinker, ou um app privado criado na Plataforma Zapier. Isso é uma chamada HTTP genérica, sem modelo de sessão nem descoberta de modelos.
- Restrições práticas: o Thinker precisa estar em **URL pública** (a execução é na nuvem do Zapier; `localhost` não serve); cada ação tem **limite fixo de 30 s**, então só chamadas sem `stream` e com modelo rápido; payload máximo de 5 MB.
- O Zapier **não envia cabeçalho de sessão**; só o que o usuário colocar em Headers. O Thinker classifica o chamador como `unknown`.
- O Thinker tem Zapier cadastrado (Chat Completions) mas **sem snippet, guia nem seção na documentação** (G1, issue #391).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Zapier help center (semente confirmada) | <https://help.zapier.com> | 2026-11-03 |
| Send webhooks in Zaps (ação Webhooks by Zapier) | <https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps> | atualizado 2026-08-10 |
| ChatGPT (OpenAI) on Zapier | <https://help.zapier.com/hc/en-us/articles/14860148802829-How-to-get-started-with-ChatGPT-OpenAI-on-Zapier> | atualizado 2026-10-01 |
| Use your own AI accounts in Zapier (Enterprise, Bedrock) | <https://help.zapier.com/hc/en-us/articles/44335174141581-Use-your-own-AI-accounts-in-Zapier> | atualizado 2026-07-31 |
| Which AI models can you automate on Zapier? (blog) | <https://zapier.com/blog/ai-models-on-zapier/> | publicado 2026-03, atualizado 2026-10 |
| Timeouts de ação (Plataforma) | <https://docs.zapier.com/platform/build/troubleshoot-action-timeouts> | 2026-11-03 (sem data na página) |
| Static IP para Zapier | <https://help.zapier.com/hc/en-us/articles/15406083674509-Use-a-static-IP-address-to-connect-to-Zapier> | 2026-11-03 |
| Zapier MCP (Zapier como servidor MCP) | <https://docs.zapier.com/mcp/get-started/connect> | 2026-11-03 |
| Integração Helicone x Zapier (exemplo de gateway) | <https://docs.helicone.ai/gateway/integrations/zapier> | 2026-11-03 |

## Contrato

### Configuração do gateway

- **Apps nativos de IA:** sem campo de URL base. ChatGPT (OpenAI): API key e Organization ID opcional. AI by Zapier: modelos embutidos (cobrados em tasks) ou BYOK com OpenAI, Anthropic, Google, Azure OpenAI e Amazon Bedrock. Apps diretos adicionais (blog, 2026-10): Gemini (Vertex), DeepSeek, Grok, Mistral, OpenRouter, Groq, AssemblyAI. Nenhum permite apontar a um endpoint arbitrário (não encontrado nas páginas lidas; confirmar na interface).
- **Admin Center (Enterprise):** "Use your own AI accounts" só cobre AWS Bedrock hoje (Vertex e Foundry pedidos como feature); vale para Agents e Knowledge, não para o AI by Zapier. Sem endpoint custom.
- **Webhooks by Zapier > Custom Request:** o usuário digita URL, método, cabeçalhos (campo Headers) e corpo bruto (JSON/XML). O Zapier envia o corpo sem reformatar; o `Content-Type: application/json` deve ser posto à mão (relato da comunidade, não confirmado em doc oficial). Basic Auth existe; auth mais elaborada exige app privado. Para o Thinker: `POST https://<host>/v1/chat/completions` com `Authorization: Bearer thk_...`.
- **App privado (Plataforma Zapier CLI):** permite uma integração própria com auth arbitrária e ações com chamadas HTTP; custo de manutenção alto, não avaliado em detalhe.
- **Alcance de rede:** execução na nuvem do Zapier (AWS us-east-1, faixas dinâmicas). Plano pago pode usar IP estático (`44.214.195.64/28`, `18.246.81.208/28`) para liberar firewall do Thinker. Um Thinker em `localhost`/LAN é inalcançável sem túnel ou proxy público.

### Seleção de modelo

- No Webhooks Custom Request o `model` é uma string do corpo escolhida pelo usuário: `auto` ou um modelo virtual do Thinker. Não há `GET /models` nem descoberta.
- Nos apps nativos, o modelo vem de listas fixas do Zapier (o Send Prompt legado do ChatGPT lista só `babbage-002`, `davinci-002`, `gpt-3.5-turbo-instruct`). Irrelevante para o Thinker.

### Cabeçalhos e sessão

| Cabeçalho | Valor | Quando |
|---|---|---|
| `User-Agent` | contém `Zapier` (relato de staff da comunidade, valor exato não confirmado) | chamadas do Webhooks; app privado pode definir outro |
| `Content-Type` | o que o usuário definir | Custom Request |
| cabeçalhos customizados | livres, no campo Headers | só se configurados |

- Não há id de sessão, de Zap nem de execução. O usuário pode colocar `x-session-key` fixo (por Zap) em Headers. Mapear valor dinâmico (id do Zap run) não foi confirmado; o editor permite inserir campos de passos anteriores em Headers (comportamento padrão de campos mapeáveis, não confirmado para este campo).

### Outros endpoints

- Nenhum: sem count_tokens, models, health ou telemetria dirigidos ao gateway. O Zapier não chama o Thinker além do POST configurado.

### Recursos usados

- Só o que o usuário colocar no corpo: `messages`, `temperature`, `response_format`, `tools` etc. como JSON livre. A resposta é entregue ao próximo passo como campos parseados; **SSE não é tratado**, então `stream` deve ficar desligado.
- Ação com limite de **30 s** (`perform`); passado disso o editor mostra "The app did not respond in-time" e o Zap History registra timeout. Não pode ser aumentado; apps privados podem usar callback assíncrono, o Webhooks não.
- Payload máximo de 5 MB nas ações de webhook.

### Erros e retentativas

- Falha HTTP (4xx/5xx) faz o passo falhar; retentativas automáticas e Autoreplay dependem do plano e da configuração do Zap (não detalhado nas páginas lidas, `(não confirmado)`). O corpo de erro do Thinker (`error.message`) fica visível no Zap History.
- 429/529 não têm tratamento especial documentado para o Webhooks.

### Snippet de setup do Thinker

- Não existe. Proposta (G1): ação Webhooks by Zapier > Custom Request, POST, URL pública `/v1/chat/completions`, Headers `Authorization: Bearer thk_...` e `Content-Type: application/json`, corpo `{"model":"auto","messages":[{"role":"user","content":"..."}]}`, ler `choices[0].message.content`.

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-03:

- Superfície: Chat Completions (`packages/shared/src/agent-type.ts:81`), categoria `automation` (`agent-type.ts:130`), rótulo `Zapier` (`:107`), ícone `/icons/zapier.svg` (`:142`).
- Endpoint servido: `POST /v1/chat/completions` (`packages/backend/src/routing/proxy/proxy.controller.ts:246`); stream só se `body.stream === true` (`:290`).
- Sessão: só `x-session-key` (`proxy.controller.ts:277`, `:899`; `proxy-session-scope.ts`); sem o cabeçalho, sessão `default`, sem `providerCacheKey` nem `momentumKey`.
- Classificação do chamador: `classifyCaller` não reconhece o UA do Zapier e devolve `sdk: 'unknown'` (`packages/backend/src/routing/proxy/caller-classifier.ts:91-131`).
- Setup: **nenhum snippet** (`packages/shared/src/setup-snippets.ts:117-125` só tem openclaw, claude-code, nanobot, codex, n8n), **nenhum guia** (`packages/frontend/src/components/SetupStepAddProvider.tsx:85-110`, `harnessGuide` devolve `null` e `PLATFORM_TO_TOOLKIT` (`:34`) não tem zapier, então o modal fica só com o título) e nenhuma menção em `docs/usuario/conectar-harnesses.md`.
- Testes: `packages/shared/__tests__/agent-type.spec.ts:25,197-205` (apenas presença na categoria e ícone).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Sem snippet, guia nem seção de docs do Zapier. O único caminho é Webhooks by Zapier > Custom Request (URL pública, limite de 30 s, sem stream); os apps de IA nativos não aceitam Base URL. O modal de setup do agente Zapier fica vazio. | frontend-dev, docs-ptbr | [#391](https://github.com/patrickbrandao/thinker/issues/391) | aberta |
| G2 | degradação | O Zapier não envia cabeçalho de sessão; só dá para fixar `x-session-key` em Headers. Toda chamada cai na sessão `default`. Mesma causa de #380. | frontend-dev | [#380](https://github.com/patrickbrandao/thinker/issues/380) (comentado) | aberta |
| G3 | oportunidade | Reconhecer o User-Agent do Zapier em `classifyCaller` para atribuir os logs (hoje `unknown`). Depende de confirmar o UA exato em um log real. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa, só documentação pública (sem acesso ao código do Zapier). Identidade do harness confirmada; conclusão central: nenhum app de IA nativo aceita Base URL, só Webhooks Custom Request ou app privado. Lacunas G1 a G3; G1 aberta como #391, G2 vinculada a #380.
