---
id: harness-copilot-cli
categoria: harness
entidade: Copilot CLI
agente: harness-copilot-cli
thinker_ids: [copilot-cli]
revisado_em: 2026-11-03
versao_observada: copilot-cli v1.0.105 (npm @github/copilot 1.0.105, commit 845c22879d4); docs 2026-11-03
---

# Copilot CLI (harness)

Especificação mantida pelo agente `harness-copilot-cli` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: o harness é o **GitHub Copilot CLI** (`copilot`, pacote npm `@github/copilot`). O repositório `github/copilot-cli` é **só distribuição** (README, `changelog.md`, `install.sh`): o código do cliente é fechado e vem como binário nativo por plataforma (`@github/copilot-<os>-<arch>`, ~180 MB). Não há fonte para ler; o contrato abaixo vem dos docs oficiais e do changelog. Confiança na identificação: alta.
- Fala com um gateway pelo recurso **BYOK/BYOM** (traga seu modelo): provedores em `providers.json`. Tipos `openai` (Chat Completions, `wireApi: completions`, ou Responses, `wireApi: responses`), `azure` e `anthropic`.
- Exige tool calling e streaming no modelo. Para modelo que não conhece, assume 128000 tokens de prompt; o usuário deve informar `maxPromptTokens`/`maxOutputTokens`.
- Cabeçalhos: nenhum cabeçalho de sessão documentado para BYOK. Fontes de terceiros dizem que o CLI só manda `Authorization` e não aceita cabeçalhos customizados (não confirmado). Logo o Thinker cai sempre em sessão `default` (G2).
- Thinker hoje: plataforma `copilot-cli` existe (Chat Completions), mas **sem snippet de setup e sem seção na documentação de usuário** (G1, issue #370).
- Seeds: as duas fontes semente (repositório e página de docs) estão corretas como projeto, mas a página de docs semente é genérica; o contrato de BYOK está em outra página (ver Fontes).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Copilot CLI repository (só distribuição + changelog) | <https://github.com/github/copilot-cli> | v1.0.105 (estável; há pré-releases `v1.0.106-N` de 2026-11-03) |
| Changelog | <https://github.com/github/copilot-cli/blob/main/changelog.md> | até 1.0.105 (2026-10-27) |
| Docs: usar modelos BYOK (contrato de `providers.json`) | <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models> | 2026-11-03 |
| Docs: Copilot CLI (semente) | <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli> | não usada para BYOK (semente genérica) |
| Docs: referência de comandos | <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference> | 2026-11-03 (parcial: lidos os primeiros 100 mil caracteres; só variáveis de auth e `COPILOT_HOME`) |
| Cloudflare AI Gateway, integração Copilot CLI (terceiros) | <https://developers.cloudflare.com/ai-gateway/integrations/coding-agents/github-copilot-cli/> | 2026-11-03 (lead; variáveis `COPILOT_PROVIDER_*`) |
| npm `@github/copilot` | <https://www.npmjs.com/package/@github/copilot> | 1.0.105 (loader de 5 KB; binário em pacote por plataforma; conteúdo do binário comprimido, não inspecionável por `grep`) |

## Contrato

### Configuração do gateway

Fonte: docs BYOK (2026-11-03).

- Arquivo `providers.json` no diretório de configuração (`~/.copilot`, ou `COPILOT_HOME`); outro caminho via `COPILOT_PROVIDERS_CONFIG` (tem precedência sobre as variáveis de ambiente). Reiniciar o CLI após editar.
- `providers[]`: `name` (único), `type` (`openai` padrão, `azure`, `anthropic`), `baseUrl`, `apiKey` ou `bearerToken` (opcionais), `wireApi` (`completions` padrão, `responses`), `azure.apiVersion`. Chave em texto puro; `$VAR` não é expandido.
- `baseUrl` é a URL completa da API; para servidores OpenAI-compatíveis em outra máquina inclui `/v1`. O CLI acrescenta `/chat/completions` (Cloudflare, não confirmado nos docs oficiais).
- Variáveis de ambiente alternativas (não confirmado; só em documentação de terceiros): `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_API_KEY` (e `COPILOT_PROVIDER_BEARER_TOKEN`), `COPILOT_MODEL`, `COPILOT_PROVIDER_MAX_PROMPT_TOKENS`, `COPILOT_PROVIDER_MAX_OUTPUT_TOKENS`.
- `COPILOT_OFFLINE=true` impede contato com servidores do GitHub (telemetria etc.); a flag `--disable-client-telemetry` existe desde o changelog 1.0.x. Para isolamento total o provedor deve ser local.
- Ollama em `127.0.0.1:11434` é descoberto sozinho (`OLLAMA_HOST` muda); remoto precisa de entrada no arquivo.
- Autenticação do GitHub é separada (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`); com BYOK o login no GitHub não é necessário para o modelo próprio, mas o changelog indica que modelos em `providers.json` convivem com sessão logada (1.0.10x: provedores locais/loopback não bloqueiam Auto).

### Seleção de modelo

- `models[]`: `id` (nome livre, ou o nome enviado se não houver `wireModel`), `provider` (igual ao `name` do provedor), `wireModel` (nome exato enviado ao provedor; no Azure, a implantação), `modelId` (nome que o CLI reconhece, para aplicar capacidades e limites), `maxPromptTokens`, `maxOutputTokens` (inteiros > 0).
- Seleção: `copilot --model NOME-DO-PROVEDOR/NOME-DO-MODELO` ou `/model` na sessão. Sem listagem: o CLI **não** consulta `GET /v1/models` do provedor para BYOK (não confirmado; os docs só descrevem a lista estática). Não há fonte indicando que `auto` do Thinker seja tratado de forma especial; basta declarar um modelo com `id`/`wireModel` `auto`.
- Modelo desconhecido: o CLI assume 128000 tokens de prompt; limites maiores que a janela real não ampliam nada.

### Cabeçalhos e sessão

- Nenhum cabeçalho de sessão, de sessão-mãe ou de User-Agent próprio está documentado para BYOK. O changelog cita `COPILOT_AGENT_SESSION_ID` apenas como variável de ambiente exportada a shells e servidores MCP (1.0.x), não como cabeçalho de inferência.
- Cloudflare afirma que o CLI autentica só com `Authorization` e não manda cabeçalhos customizados (não confirmado). Também não há campo `headers` documentado em `providers.json`.
- **Precisa de verificação ao vivo:** capturar uma requisição real (por exemplo ao Thinker em ambiente de teste) e registrar User-Agent, versão e qualquer cabeçalho de sessão.

### Outros endpoints

- Com BYOK: nenhum endpoint de listagem, contagem de tokens ou saúde é documentado. O CLI continua chamando serviços do GitHub (login, telemetria, regras de exclusão de conteúdo, quotas) salvo `COPILOT_OFFLINE=true`; falha neles não afeta o gateway.

### Recursos usados

- Tools (obrigatório), streaming (obrigatório), reasoning effort aplicado a provedores BYOM (changelog), imagens (anexos de arquivo >5 MiB enviados via Responses; reenvio sem imagens quando o provedor rejeita), compactação automática de histórico (/compact, checkpoints), subagentes com modelo próprio em BYOK, Responses sobre WebSocket para provedores OpenAI-compatíveis (changelog: "websocket responses support for BYOK OpenAI-compatible providers"), `max_output_tokens` em Responses, adaptive thinking para modelos Anthropic em BYOK.
- Atenção: WebSocket em `/v1/responses` é um recurso novo do cliente; o Thinker só trata HTTP (ver Lacunas, G3).

### Erros e retentativas

- Changelog: respostas interrompidas por erro do servidor/overload são repetidas com backoff, mostrando mensagem e request ID do provedor; imagens rejeitadas por limite são repetidas sem imagem ou com payload menor; Anthropic grande demais é repetido reduzindo imagens/anexos. Códigos exatos (429/529) e tetos de tentativas não estão documentados.
- Erro de tamanho de requisição: os docs mandam reduzir `maxPromptTokens`/`maxOutputTokens`.

### Snippet de setup do Thinker

Não existe snippet no Thinker (G1). Proposta, derivada dos docs BYOK (não testada com o binário real):

```json
{
  "providers": [
    { "name": "thinker", "type": "openai", "baseUrl": "http://localhost:2099/v1", "apiKey": "thk_SUA_CHAVE" }
  ],
  "models": [
    { "id": "auto", "provider": "thinker", "maxPromptTokens": 200000, "maxOutputTokens": 32000 }
  ]
}
```

Uso: `copilot --model thinker/auto`.

## Como o Thinker implementa hoje

- Plataforma `copilot-cli` em `AGENT_PLATFORMS` (`packages/shared/src/agent-type.ts:41`), superfície `chat_completions` (`packages/shared/src/agent-type.ts:91`), rótulo "Copilot CLI" (`:117`), categoria `coding` (`:132`), ícone (`:152`, variante escura `:165`). A superfície é só metadado de exibição; o gateway aceita Chat Completions (`proxy.controller.ts:246-252`), listagem em `GET /v1/models` (`proxy.controller.ts:176`).
- Sessão: o gateway lê somente `x-session-key` (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`; `provider-hooks.ts:41`, `:50`). O Copilot CLI não o envia, portanto o escopo de sessão é sempre o do agente (`default`).
- Atribuição do cliente (`caller-classifier.ts:30`) usa User-Agent, referer e `x-title`; não há regra para Copilot CLI.
- Não há snippet em `PLATFORM_SETUP_SNIPPETS` (`packages/shared/src/setup-snippets.ts:111-119`) e `docs/usuario/conectar-harnesses.md` não tem seção do Copilot CLI (seções: Claude Code `:18`, Codex `:36`, OpenCode `:57`, OpenClaw e Hermes `:82`, SDKs `:104`).
- `/v1/responses` HTTP existe para Codex; `POST /v1/responses` em `proxy.controller.ts:254`; não há gateway WebSocket no backend (grep em `packages/backend/src`), logo WebSocket de Responses não é tratado (ver G3).
- Teste da plataforma: `packages/shared/__tests__/agent-type.spec.ts:35`, `:212`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/frontend/src/components/SetupModal.tsx`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Sem snippet de setup nem seção de documentação para o Copilot CLI. A configuração exige `providers.json` com `baseUrl` terminando em `/v1`, chave literal, `wireApi` e limites explícitos (padrão 128000 tokens para modelo desconhecido), o que o usuário não descobre sozinho. Arquivos: `setup-snippets.ts:111`, `conectar-harnesses.md`. Mudança: snippet + seção. | frontend-dev / docs-ptbr | [#370](https://github.com/patrickbrandao/thinker/issues/370) | resolvida (snippet providers.json e seção no guia) |
| G2 | degradação (não confirmado) | O CLI aparentemente não envia cabeçalho de sessão em BYOK nem aceita cabeçalhos customizados; o Thinker cai sempre em sessão `default` (cache de prompt e momentum por agente, não por conversa). Mesma consequência de #318/#320, mas causa diferente (não é cabeçalho ignorado; não há cabeçalho). Confirmar com captura ao vivo antes de abrir issue. | backend-dev | — (a confirmar) | aberta |
| G3 | oportunidade | O changelog diz que o CLI usa Responses por WebSocket para provedores OpenAI-compatíveis BYOK quando `wireApi: responses`. Verificar se o Thinker aceita `/v1/responses` por upgrade WebSocket; hoje só HTTP. Também `type: anthropic` permitiria usar `/v1/messages` com modelos Claude. | backend-dev | — (oportunidade) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Repositório confirmado como distribuição de binário fechado; contrato extraído dos docs BYOK e do changelog até 1.0.105. Seed "use-copilot-cli" substituída por "use-byok-models" para o contrato de provedores. Abertas G1 (#370), G2 e G3. Binário nativo inspecionado por `grep`: conteúdo comprimido, sem strings úteis.
