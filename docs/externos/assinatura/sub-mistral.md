---
id: sub-mistral
categoria: assinatura
entidade: Mistral Vibe
agente: sub-mistral
thinker_ids: [mistral]
revisado_em: 2026-11-03
versao_observada: mistral-vibe v3.0.4 (338ad4b), docs 2026-11-03
---

# Mistral Vibe (assinatura)

Especificação mantida pelo agente `sub-mistral` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Mistral Vibe é o plano de código da Mistral (CLI, IDE, web), incluído nos planos Le Chat (Free limitado, Pro, Team). A credencial é uma **chave de API Mistral** (`MISTRAL_API_KEY`) obtida por login no navegador (console.mistral.ai) ou criada em Code > Vibe CLI; não há OAuth com refresh no cliente, só a troca de um código por uma `api_key`.
- A inferência vai para `https://api.mistral.ai/v1` (Chat Completions) com o modelo meterado `mistral-vibe-cli-latest` (alias exibido: Mistral Medium 3.5). O uso consome o crédito mensal incluído do plano; sem pay-as-you-go, o Vibe pausa até o próximo ciclo.
- Pontos em aberto: se tráfego de terceiros pelo gateway é coberto pelo plano ou cobrado como API pay-as-you-go (relatos conflitantes), e se o backend exige identificação de cliente.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Mistral Vibe repository | <https://github.com/mistralai/mistral-vibe> | v3.0.4 (2026-10-30), commit 338ad4b |
| Mistral docs (Vibe, API keys e perfis) | <https://docs.mistral.ai/vibe/code/cli/api-keys-profiles> | lido em 2026-11-03 |
| Mistral docs (modelos) | <https://docs.mistral.ai/getting-started/models/models_overview/> | lido em 2026-11-03 |
| Preços e planos | <https://mistral.ai/pricing> | lido em 2026-11-03 |

## Contrato

### Planos

Fonte: <https://mistral.ai/pricing> (2026-11-03).

| Plano | Preço | Vibe |
|---|---|---|
| Free | US$ 0 | sessões de código limitadas |
| Pro | US$ 14,99/mês | "o dia todo" no CLI, IDE e web; US$ 15/mês em créditos de API |
| Education (estudantes) | acesso Pro até 12 meses | a página é inconsistente (US$ 5,99 no FAQ, 14,99 no cartão); créditos de API US$ 25,50 |
| Team | US$ 24,99/usuário/mês | limites maiores que Pro |
| Enterprise | sob consulta | SSO, auditoria, self-hosted |

- O uso mensal incluído é compartilhado entre Studio, API e Vibe Code; o Vibe consome primeiro. Pay-as-you-go vem desligado por padrão: esgotado o incluído, o Vibe pausa até o próximo ciclo; ligado, consome créditos pré-pagos até zerar. Alguns Pro comprados via parceiros (Google, Apple, Free Mobile, Orange) não podem ativar pay-as-you-go. Fonte: [docs API keys e perfis](https://docs.mistral.ai/vibe/code/cli/api-keys-profiles).
- Os números exatos de cota por plano não são publicados.

### Autenticação

- **Login no navegador (padrão no Vibe ≥ 3.0)**: `POST {console}/api/vibe/sign-in` com `code_challenge` (S256) devolve `process_id`, `sign_in_url`, `poll_url`, `expires_at`; o cliente consulta `poll_url` (status `pending`/`completed`/`expired`/`denied`/`error`) e, em `completed`, troca o `exchange_token` por `{ "api_key": ... }`. Base padrão: `https://console.mistral.ai` (`vibe/core/config/_defaults.py`, `vibe/setup/auth/http_browser_sign_in_gateway.py`). Erro `9004` na criação da chave indica workspace não elegível para Vibe.
- **Chave colada**: `MISTRAL_API_KEY` (ordem: variável de ambiente, `~/.vibe/.env`, keyring). A chave não expira por refresh; vale até ser revogada.
- **Conta e plano**: `GET {console}/api/vibe/whoami` com `Authorization: Bearer <key>` devolve `plan_type` (`api`, `chat`, `mistral_code`), `plan_name`, `has_paid_vibe_entitlement`, `primitive_access_scope` (`shared_only` ou `personal_and_shared`), `api_base`, `vibe_base`. 401/403 = chave inválida. (`vibe/setup/auth/whoami.py`, v3.0.4.)
- Existe também sessão OIDC para organizações (`/api/vibe/account-context`); fora do escopo do Thinker.

### Endpoints

- Inferência: `https://api.mistral.ai/v1` (Chat Completions), `Authorization: Bearer <key>`. Backend `Backend.MISTRAL` do Vibe usa o SDK Mistral. (`vibe_schema.py` DEFAULT_PROVIDERS.)
- Modelos meterados pelo plano usados pelo Vibe v3.0.4:
  - `mistral-vibe-cli-latest`: agente principal; alias `mistral-medium-3.5`; contexto 262144; preço de referência no cliente US$ 1,5 entrada / 7,5 saída / 0,15 entrada em cache por 1M; raciocínio `off`/`high`; aceita imagens.
  - `mistral-vibe-cli-fast`: modelo pequeno para utilitários (títulos, descrição de imagem etc.), US$ 0,1/0,3 por 1M; cai para `mistral-small-latest` se indisponível.
  - `mistral-vibe-cli-with-tools`: padrão do `web_search` (não é chat comum).
- A página de modelos da Mistral lista Medium 3.5 (`mistral-medium-3-5`) como depreciado a partir de 2026-10-31 e aposentado em 2027-04-30 (não confirmado como isso afeta o alias `mistral-vibe-cli-latest`, resolvido no servidor).
- Listagem: `GET https://api.mistral.ai/v1/models`; entradas trazem `capabilities.completion_chat` e `deprecation`. (Se `mistral-vibe-cli-latest` aparece na lista com uma chave Vibe: não confirmado.)

### Identificação do cliente

- User-Agent `Mistral-Vibe/<versão>` nas requisições de modelo; o 3.0.4 corrigiu a regressão que enviava o UA padrão da biblioteca HTTP (`vibe/utils/http.py:286`, CHANGELOG 3.0.4). `extra_headers` do provedor pode sobrescrever.
- Cabeçalho `x-affinity` com id de afinidade da sessão (`mistralai_vibe_local_harness/vibe/_runtime_config.py:511-519`); semântica exata (afinidade de cache) não confirmada.
- Metadados de requisição (`build_request_metadata`): `os`, `arch`, `os_version`, `version`, `session_id`, `parent_session_id`, `call_type`, `message_id`, `user_plan`.
- Não foi encontrado bloqueio por UA/versão no código do cliente (o gate, se existir, é do servidor): não confirmado.
- Cliente a espelhar: `mistral-vibe` v3.0.4.

### Clientes permitidos e termos

- Docs oficiais descrevem como apontar o Vibe para outros provedores, mas não dizem se a chave Vibe pode ser usada em outros clientes.
- Relatos de comunidade (Reddit, mai/2026; não confirmado): funcionário disse que a chave Vibe funciona em qualquer software, mas o uso externo pode ser cobrado como pay-as-you-go. Um registro de termos comerciais de terceiro cita cláusula contra integrar o Vibe em produtos oferecidos a terceiros sem autorização (não confirmado no documento original).
- Risco de ação na conta por tráfego via gateway: não confirmado.

### Cotas e uso

- Cota única mensal em créditos (compartilhada Studio/API/Vibe), sem janela de 5 h. Leitura do restante: apenas pelo console da Mistral; o `whoami` não devolve uso. Cabeçalhos de rate limit da API Mistral (`x-ratelimit-*`): não verificados.

### Erros

- 401/403: chave inválida ou sem acesso Vibe (whoami usa 401/403 para isso).
- Cota esgotada sem pay-as-you-go: o Vibe "pausa"; o código de erro HTTP e o corpo exatos: não confirmado (suspeita de 429 ou 402).
- Modelo fora do plano: não confirmado.

## Como o Thinker implementa hoje

- Autenticação: token de assinatura colado (`subscriptionAuthMode: 'token'`), rótulo "Mistral Vibe subscription", placeholder "Paste your Mistral Vibe API key"; modelo conhecido único `mistral-vibe-cli-latest` (correspondência exata); `maxContextWindow: 200000`, cache de prompt sim, batch não. `packages/shared/src/subscription/configs.ts:127-139`.
- Inferência: usa o mesmo endpoint da API, `https://api.mistral.ai`, Chat Completions, cabeçalhos `Authorization` e `Content-Type` apenas (`packages/backend/src/routing/proxy/provider-endpoints.ts:86-89,371-377`).
- Cache: `prompt_cache_key` com hash é aplicado para `mistral` (`packages/backend/src/routing/proxy/provider-client.ts:937-939`); se a API Mistral aceita esse campo: não confirmado.
- Descoberta de modelos: `GET https://api.mistral.ai/v1/models` com Bearer; para assinatura (`mistral-subscription`) o resultado é filtrado para `knownModels` e descarta `deprecation` e `completion_chat === false` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:514-538,917-926,1097-1098`). Para a chave de API normal, `^mistral-vibe-cli` é escondido (`:442-443`); `voxtral-mini-2602` é excluído nos dois (`:481-486`).
- Mapeamento id para provedor: `/^mistral-|^codestral|^pixtral|^open-mistral/` (`packages/shared/src/provider-inference.ts:14`).
- Sem entrada em `packages/backend/src/common/constants/subscription-clients.ts` (sem identificação de cliente).
- Sem verificação de plano (`/api/vibe/whoami`) nem leitura de uso.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`

Outros arquivos que citam `mistral`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `maxContextWindow` de 200000 na assinatura `mistral`; o modelo padrão do Vibe declara 262144 (`configs.ts:133`, `model-fallback.ts:188`). Subir para 262144. | providers | [#336](https://github.com/patrickbrandao/thinker/issues/336) | aberta |
| G2 | degradação | Thinker não envia `User-Agent: Mistral-Vibe/<versão>` nem `x-affinity` (só `Authorization`/`Content-Type`, `provider-endpoints.ts:86-89`); perda de afinidade de cache e identificação (impacto não confirmado). | providers | [#337](https://github.com/patrickbrandao/thinker/issues/337) | aberta |
| G3 | oportunidade | Só `mistral-vibe-cli-latest` é conhecido; `mistral-vibe-cli-fast` (modelo pequeno meterado pelo plano) fica de fora, assim como qualquer outro modelo liberado à chave. Validar com conta real antes (a chave vale também na API padrão). | providers | — | aberta |
| G4 | oportunidade | Sem leitura de plano/uso: `GET {console}/api/vibe/whoami` valida a chave e devolve plano e `has_paid_vibe_entitlement`; permitiria validar no cadastro e avisar que cota esgotada sem pay-as-you-go pausa o uso. Também falta aviso sobre cobrança possivelmente como API pay-as-you-go no tráfego de terceiros. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (mistral-vibe v3.0.4, docs e preços de 2026-11-03). Contrato escrito; G1 e G2 abertas com issues; G3 e G4 registradas como oportunidade.
