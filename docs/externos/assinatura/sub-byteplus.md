---
id: sub-byteplus
categoria: assinatura
entidade: BytePlus ModelArk Coding Plan
agente: sub-byteplus
thinker_ids: [byteplus]
revisado_em: 2026-11-03
versao_observada: docs 2026-10-30 (página do plano + docs ModelArk; sem acesso ao corpo das páginas SPA)
---

# BytePlus ModelArk Coding Plan (assinatura)

Especificação mantida pelo agente `sub-byteplus` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Plano de assinatura mensal/trimestral da BytePlus (ModelArk) para ferramentas de código. Duas camadas pessoais, Lite e Pro (Pro com cerca de 5x a cota do Lite), mais um plano Team com chave própria.
- Autenticação é uma chave de API exclusiva do Coding Plan (colada), sem OAuth. Não é a mesma chave da plataforma ModelArk e **não deve** ser usada no endpoint geral `/api/v3` (cobrança avulsa, não consome a cota).
- Dois protocolos no mesmo host: OpenAI em `/api/coding/v3` e Anthropic em `/api/coding`. O Thinker já usa os dois.
- A lista de modelos mudou: a página do plano agora cita Dola-Seed-2.0-pro/lite, GLM-5.3-Flash e a série DeepSeek-V4; a lista fixa do Thinker está desatualizada (G1, issue #329).
- Confiança média: o corpo das páginas de docs.byteplus.com é renderizado no cliente e não pôde ser lido; os fatos vêm da página do plano, de resultados de busca com trechos das docs e de clientes de terceiros (marcados).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Coding Plan page | <https://www.byteplus.com/en/activity/codingplan> | lida em 2026-11-03 (preços não carregam sem JS) |
| ModelArk docs, seção Coding Plan | <https://docs.byteplus.com/en/docs/ModelArk/> | páginas com "Last updated" 2026-09-28 a 2026-10-30; corpo ilegível (SPA) |
| Quick start (docs) | <https://docs.byteplus.com/en/docs/ModelArk/1928261> | trechos via busca, 2026-11-03 |
| Integração Claude Code (docs) | <https://docs.byteplus.com/en/docs/ModelArk/2188959> | trechos via busca |
| Release notes do plano | <https://docs.byteplus.com/en/docs/ModelArk/2222865> | corpo ilegível |
| Anúncio de descontinuação | `/docs/modelark/coding-plan-personal-model-deprecation` | corpo ilegível |
| pi-byteplus-modelark 1.2.5 (terceiro) | <https://pi.dev/packages/pi-byteplus-modelark> | 2026-11-03 |
| OpenClaw v2026.10.10, `extensions/byteplus/openclaw.plugin.json` (terceiro) | <https://github.com/openclaw/openclaw> | tag v2026.10.10 |

Dica para a próxima revisão: as docs são SPA; um navegador real (ou o console BytePlus) é necessário para ler Subscription overview, FAQ, release notes e a página de descontinuação.

## Contrato

### Planos

- Lite e Pro, cobrança em USD, opções mensal e trimestral, renovação automática recomendada. A página do plano apresenta Lite como 3x o uso do Claude Pro e Pro como 5x o Lite (página do plano, 2026-11-03).
- Preço: a página não carrega valores sem JS. Terceiros divergem (CreditsPlan: Lite US$10 e Pro US$50 por mês; Kilo: Lite US$20 por 30 dias) (não confirmado).
- Cotas (terceiros, não confirmado em fonte primária): Lite cerca de 1.900 requisições por janela de 5 h, 12.000 por semana e 24.000 por mês de assinatura; Pro cerca de 9.500 / 60.000 / 120.000. Janela de 5 h móvel, semana reiniciando na segunda-feira, mês no dia de assinatura. A doc do Team avisa que a cota real varia com a complexidade do projeto, aceite automático e uso de thinking.
- Esgotada a cota do pacote, ela volta no próximo ciclo; outros pacotes e saldo da conta não são cobrados (página do plano).
- Modelos (página do plano, 2026-11-03): Dola-Seed-2.0-pro, Dola-Seed-2.0-lite (FAQ), GLM-5.3-Flash, série DeepSeek-V4 e modo Auto; disponibilidade pode variar por país/região. Listas de terceiros no mesmo período citam ainda `dola-seed-2.0-code`, `glm-5.2`, `glm-5.1`, `glm-4.7`, `kimi-k2.5`/`kimi-k2.6`, `gpt-oss-120b`, `deepseek-v3.2`, `bytedance-seed-code` (não confirmado qual segue ativo). Há anúncio oficial de descontinuação cujo conteúdo não foi lido; um rascunho de terceiros cita aviso de 23/set para kimi-k2.5, glm-5.1, gpt-oss-120b e bytedance-seed-code (não confirmado).
- Plano Team: lista mais estreita (`dola-seed-2.0-code`, `bytedance-seed-code`) e chave própria (não confirmado). Fora do escopo do Thinker hoje.

### Autenticação

- Chave de API do Coding Plan, criada no console BytePlus. Uma chave cobre todos os modelos do plano (pi 1.2.5). A chave do plano é diferente da chave da plataforma ModelArk; não misturar (docs, via busca).
- Sem OAuth, sem device code, sem refresh. Enviada como `Authorization: Bearer <key>` (Claude Code usa `ANTHROPIC_AUTH_TOKEN`, que o CLI envia como Bearer).

### Endpoints

| Protocolo | Base URL | Caminho | Quem usa |
|---|---|---|---|
| OpenAI Chat Completions | `https://ark.ap-southeast.bytepluses.com/api/coding/v3` | `/chat/completions`, `/models` | Cline, Codex, Cursor, OpenCode, OpenClaw, pi |
| Anthropic Messages | `https://ark.ap-southeast.bytepluses.com/api/coding` | `/v1/messages` | Claude Code (`ANTHROPIC_BASE_URL`) |

- **Proibido** usar `https://ark.ap-southeast.bytepluses.com/api/v3` (endpoint geral): não consome a cota do plano e gera cobrança adicional (docs, via busca).
- Modelo `ark-code-latest` é o modo Auto, usado nos exemplos OpenAI-compatíveis. Para Claude Code a doc usa um `<Model_Name>` genérico; que `ark-code-latest` funcione em `/api/coding/v1/messages` não está confirmado.
- Contexto / saída máxima (pi 1.2.5, terceiro): `ark-code-latest` 128K/8,2K; `dola-seed-2.0-*` 262K/128K; `glm-5.1` e `glm-4.7` 204K/65,5K; `kimi-k2.5` 262K/65,5K; `deepseek-v3.2` 131K/8,2K; `gpt-oss-120b` e `bytedance-seed-code` 128K/8,2K. OpenClaw v2026.10.10 declara `ark-code-latest` com 256K/4096 e `kimi-k2.5` com texto+imagem e reasoning (catálogo mínimo, não autoritativo).
- Listagem: `GET /api/coding/v3/models` (formato OpenAI `data[].id`), usada pelo Thinker; conteúdo real não verificado sem chave.

### Identificação do cliente

- Nenhuma exigência documentada de user agent, header customizado ou versão de cliente. As docs listam ferramentas compatíveis (ver abaixo); não há cliente oficial único para espelhar.

### Clientes permitidos e termos

- Ferramentas listadas na página do plano e nas docs: Claude Code, Cursor, Cline, Kilo Code, Roo Code, OpenCode, OpenClaw, Hermes Agent, Codex, TRAE, WorkBuddy, ZCode, DeepSeek Harness, OpenViking e "outras ferramentas".
- A página do plano não declara nada sobre uso fora de ferramentas de código ou via gateway. Os termos completos (Subscription overview/FAQ) não foram lidos. O risco de ação sobre a conta ao passar por um gateway é desconhecido (não confirmado).

### Cotas e uso

- Três janelas (5 h, semanal, mensal) segundo terceiros. O consumo é compartilhado entre os modelos do plano.
- Não foi encontrado endpoint ou header documentado para ler o uso restante; existe um pedido de terceiros por um medidor (robinebers/openusage#285) e um relato de medidor zerado após 58 requisições (Kilo-Org/kilocode#14620), ambos não confirmados.

### Erros

- Não encontrados códigos de erro específicos do plano em fonte primária legível. Cota esgotada, chave inválida e modelo fora do plano precisam de verificação ao vivo. Chamar `/api/v3` com a chave do plano deve falhar ou cobrar à parte (não confirmado).

## Como o Thinker implementa hoje

- Registro: id `byteplus`, nome BytePlus, aliases `byteplus-plan`, `modelark`, `modelark-coding-plan`; chave obrigatória, sem prefixo, mínimo 10 caracteres (`packages/shared/src/providers.ts:122-132`).
- Assinatura por token colado, rótulo "ModelArk Coding Plan", contexto máximo 256000, sem prompt caching nem batching (`packages/shared/src/subscription/configs.ts:47-69`).
- Modelos conhecidos, correspondência exata: ark-code-latest, bytedance-seed-code, glm-5.1, glm-4.7, deepseek-v3.2, deepseek-v4-flash, deepseek-v4-pro, kimi-k2.5, gpt-oss-120b (`packages/shared/src/subscription/configs.ts:52-63`).
- Base `https://ark.ap-southeast.bytepluses.com/api/coding` (`packages/backend/src/routing/proxy/provider-endpoints.ts:185`). Endpoint `byteplus` (OpenAI): `/v3/chat/completions`, `Authorization: Bearer` (`provider-endpoints.ts:295-301`). Endpoint `byteplus-anthropic`: `/v1/messages`, Bearer mais `anthropic-version: 2023-06-01`, sem identidade de assinatura (`provider-endpoints.ts:302-308`, headers em `:164-168`).
- Em assinatura, o roteamento troca `byteplus` por `byteplus-anthropic` (`packages/backend/src/routing/proxy/provider-hooks.ts:20`); o endpoint OpenAI fica para chave comum. O Thinker não envia beta flags da Anthropic a terceiros compatíveis como a BytePlus (`packages/backend/src/routing/proxy/anthropic-beta.ts:98`).
- Descoberta: `GET https://ark.ap-southeast.bytepluses.com/api/coding/v3/models` com Bearer, filtrada pela lista conhecida (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:56,342-345,882-886`). Capacidades de streaming marcadas em `packages/backend/src/model-discovery/model-capabilities.ts:15`.
- Frontend: subtítulo "Ark Code, Seed Code, DeepSeek, GLM, Kimi", somente assinatura, credencial api-key (`packages/frontend/src/services/providers.ts:214-225`); link para criar a chave `https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey` (`packages/frontend/src/services/provider-api-key-urls.ts:41`).
- Não há medidor de uso, nem tratamento de erro específico do plano.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A página do plano lista Dola-Seed-2.0-pro/lite, GLM-5.3-Flash e DeepSeek-V4; `knownModels` (correspondência exata) não tem os novos e o filtro de descoberta (`provider-model-fetcher.service.ts:342-345`) os esconde. Possíveis descontinuados (kimi-k2.5, glm-5.1, gpt-oss-120b, bytedance-seed-code) seguem listados. Atualizar a lista após conferir `/models` com chave real; considerar não filtrar. | `providers` | [#329](https://github.com/patrickbrandao/thinker/issues/329) | resolvida (lista de modelos atualizada) |
| G2 | oportunidade | Janelas de uso (5 h / semana / mês) e cota restante não são exibidas; não há endpoint documentado. Investigar com conta real se o console expõe uma API de uso. | `providers` | (sem issue) | aberta |
| G3 | oportunidade | `maxContextWindow` fixo em 256000 para todo o plano, mas `ark-code-latest`, `deepseek-v3.2`, `gpt-oss-120b` têm 128K-131K (terceiro). Usar contexto por modelo. | `providers` | (sem issue) | aberta |

## Histórico

- 2026-11-03: primeira revisão completa. Página do plano lida; docs.byteplus.com é SPA e só rendeu navegação (datas "Last updated" 2026-09-28 a 2026-10-30). Contrato montado a partir da página do plano, trechos de busca das docs, pi-byteplus-modelark 1.2.5 e OpenClaw v2026.10.10. Abertas G1 (#329), G2, G3. Pendente: leitura de Subscription overview, FAQ, release notes e descontinuação em navegador.
