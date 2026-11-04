# ADR 0009 — OpenCode: fim do nome Zen, catálogo próprio e modelos gratuitos

- **Status:** aceito
- **Data:** 2026-11-02
- **Atualizado:** 2026-11-03 (catálogo em `models.opencode.ai` e monitoramento contínuo das contas, itens 2 e 9)
- **Altera:** [ADR 0003](0003-excecao-catalogos-publicos.md), que permitia buscar o documento do OpenCode Go em `raw.githubusercontent.com`

## Contexto

O OpenCode tem dois serviços de inferência: o pago por uso, que o Thinker chamava de "OpenCode Zen" (`opencode-zen`), e a assinatura OpenCode Go. O próprio OpenCode deixou de usar o nome Zen: o provedor é só "OpenCode" (id `opencode`) e a inferência fica em `https://opencode.ai/inference/...`.

O Thinker tinha três problemas com esses provedores:

- O formato de cada modelo do Go e o custo por requisição vinham do documento `go.mdx` em `raw.githubusercontent.com`, que hoje responde 404. O formato caía na heurística por família e o custo era gravado como $0.
- O OpenCode pago mandava quase tudo para `/v1/chat/completions`. O catálogo oficial define um protocolo por modelo: Chat Completions, Responses (GPT, Grok, Muse), Messages (Claude, Qwen, MiniMax) ou Google (Gemini).
- O OpenCode oferece modelos gratuitos sem conta (`Authorization: Bearer public`), mas eles só respondem ao cliente OpenCode. Outros clientes recebem 403 ou 429 `FreeUsageLimitError` ("Free models work in OpenCode"). A cota diária reinicia às 00:00 UTC e não é publicada.

`https://opencode.ai/inference/v1/models` e `/inference/go/v1/models` são públicos, sem autenticação, e trazem o protocolo, a base URL, os preços por token, os multiplicadores de horário de pico e os limites de cada modelo.

## Decisão

1. **O provedor `opencode-zen` vira `opencode`, com o nome "OpenCode".** A migration `RenameOpencodeZenToOpencode1805000000000` reescreve as conexões, as rotas guardadas (tiers, especificidade, modelos virtuais), os catálogos em cache, o playground, os parâmetros por modelo e os logs, trocando o prefixo `opencode-zen/<modelo>` por `opencode/<modelo>`. `opencode-zen` e `opencodezen` continuam como aliases, e o proxy ainda aceita `opencode-zen/<modelo>`. Um provedor customizado que usava o alias `opencode` é renomeado para `opencode-custom`.
2. **O catálogo dos dois provedores vem do próprio OpenCode, pela mesma fonte do cliente.** O `OpencodeCatalogService` lê `https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image`, o documento models.dev v2 que o cliente OpenCode 2 baixa (`packages/core/src/models-dev.ts`). Um documento traz todos os provedores; o Thinker usa só `opencode` e `opencode-go`, com o protocolo, a base URL, os preços por token, os multiplicadores de pico e os limites de cada modelo. Como o cliente, a busca manda o User-Agent do OpenCode e o `If-None-Match` com o ETag guardado (um 304 mantém a cópia em memória), tem 10 segundos no total, faz até 2 novas tentativas em erro de rede ou status transitório (408, 429, 5xx) com espera exponencial a partir de 200 ms, e é refeita em segundo plano a cada 5 minutos. É uma busca por instância, não por conta. O domínio `models.opencode.ai` é tráfego do provedor OpenCode, não phone-home: a busca (no boot e a cada 5 minutos) só acontece enquanto existe pelo menos uma conta OpenCode ou OpenCode Go ativa, de qualquer tipo (chave colada, chave `public` ou login no Console). `THINKER_CATALOG_SYNC=false` desliga essa busca. Nesse caso, e também quando `models.opencode.ai` falha antes de ter respondido uma vez, o catálogo de cada provedor vem de `opencode.ai/inference[/go]/v1/models`, no host de inferência, no primeiro uso (cache de 1 hora), como o `/models` de qualquer provedor. Esse fallback existe porque o protocolo por modelo decide o endpoint de cada requisição (item 3): sem catálogo nenhum, o roteamento cairia na heurística por família. `raw.githubusercontent.com` sai da lista do ADR 0003.
3. **Cada modelo vai para o endpoint do seu protocolo**, nos dois provedores: `/openai/v1/chat/completions`, `/openai/v1/responses`, `/anthropic/v1/messages` ou `/google/v1beta`. Sem o catálogo, a família do modelo decide.
4. **Modo gratuito.** Nada funciona sem uma conta cadastrada. Uma conta nova de OpenCode já vem com a chave `public` preenchida, como numa instalação nova do cliente; o usuário confirma para criar a conta e pode trocar a chave depois. Várias contas podem usar `public` ao mesmo tempo: cada uma é uma conexão própria, com nome próprio, e a troca de chave numa delas não afeta as outras. Com `public`, a descoberta lista só os modelos com preço zero e o proxy envia `Bearer public`. Com uma chave real, todos os modelos aparecem.
5. **O Thinker se identifica como o cliente OpenCode** em toda requisição aos dois provedores (`User-Agent: opencode/...` e `x-opencode-client`, além do `x-opencode-session` que já ia), para qualquer harness. Foi uma escolha explícita do mantenedor. É o mesmo que o Thinker já faz com o User-Agent do Codex CLI na assinatura ChatGPT.
6. **Custo.** OpenCode pago: vale o `usage.cost` que o gateway devolve; sem ele, o preço por token do catálogo com o multiplicador de pico. OpenCode Go: grava o equivalente em dólar consumido da cota, a preço de lista do catálogo Go, e ignora o custo reportado (que é $0 dentro da cota). Modelos gratuitos: $0.
7. **Cota esgotada.** Um 429 cujo corpo traz `FreeUsageLimitError`, `GoUsageLimitError`, `BudgetLimitError`, `CreditLimitExceeded` ou `insufficient_quota` aciona o fallback e põe a rota em espera pelo `Retry-After` inteiro, até 24 horas, em vez do teto de 5 minutos dos 429 comuns.
8. **Login no OpenCode Console** (device code) serve aos dois provedores. Na página do OpenCode Go, o painel mostra o medidor da cota (5 horas, semana e mês) lido de `opencode.ai/zen/go/v1/usage` só quando a página abre.
9. **Monitoramento contínuo, como um cliente aberto.** Enquanto uma conta com login no Console existe e está ativa, o `OpencodeConsoleMonitor` age como um cliente OpenCode deixado aberto: a cada 60 segundos, por login, renova o token quando faltam 5 minutos ou menos para expirar (pelo mesmo coordenador e trava de linha do proxy, então a rotação é gravada uma vez só) e lê `opencode.ai/console/api/v2/config` com os cabeçalhos do cliente (`authorization`, `x-org-id`, User-Agent). Um login é a organização no workspace: uma conta `opencode` e uma `opencode-go` da mesma organização formam um só login e leem a config uma vez. A leitura acontece também logo após o login, e nunca mais de uma vez por minuto por login, venha de onde vier. As chamadas saem pela cadeia de proxy de saída da conexão. Contas novas entram e contas removidas ou desativadas saem sem reiniciar (varredura do banco a cada minuto). Um `invalid_grant` na renovação para o monitoramento daquele login; o token de renovação fica marcado e não é mais enviado, e o proxy responde M102 ("reconecte o OAuth") quando o token de acesso expira. Um novo login retoma o monitoramento. Falhas são registradas no log uma vez por mudança de estado. Contas com chave colada ou `public` não têm sessão no Console: só a atualização do catálogo (item 2) vale para elas.

Ficam de fora: aplicar a config remota do Console (`/api/v2/config`, com BYOK, MCP e skills; o Thinker só a lê, como prova de cliente conectado), os budgets do workspace, a busca web, a voz GPT-Live e os modelos SystemOne/Jev do tipo `decision`.

## Riscos

- **Identidade de cliente.** Os modelos gratuitos são oferecidos para o cliente OpenCode. Usar a identidade dele a partir de outros harnesses contraria essa regra. O OpenCode pode bloquear o IP da instância ou passar a exigir sinais que o Thinker não envia. Nesse caso os modelos gratuitos param e o fallback assume.
- **Cota compartilhada.** Todos os agentes atrás de uma instância saem do mesmo IP e usam a mesma cota diária gratuita, cujo critério não é documentado.
- **Dados.** Alguns modelos gratuitos (Big Pickle, MiMo, Flint) podem usar os dados para treinamento. O formulário da conta avisa junto da chave `public`.

## Consequências

- O custo do OpenCode Go volta a ser gravado (deixa de ser $0), agora a preço de token em vez de estimativa por requisição.
- Configs de harness que ainda usam `opencode-zen/<modelo>` continuam funcionando. Novos snippets publicam `opencode/<modelo>`.
- A lista de destinos de saída do ADR 0003 fica só com `openrouter.ai` e `models.dev`. O teste de egresso (#34) passa a esperar `models.opencode.ai` (e, no fallback, `opencode.ai`) apenas com um provedor OpenCode cadastrado.
- Uma instância com conta OpenCode faz um GET condicional a `models.opencode.ai` a cada 5 minutos (o documento inteiro tem cerca de 10 MB; o normal é um 304) e, por login no Console, uma leitura da config por minuto, mesmo sem tráfego. Com várias réplicas, cada uma faz o seu monitoramento; a renovação continua serializada pela trava de linha.
