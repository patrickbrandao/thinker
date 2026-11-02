# ADR 0009 — OpenCode: fim do nome Zen, catálogo próprio e modelos gratuitos

- **Status:** aceito
- **Data:** 2026-11-02
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
2. **O catálogo dos dois provedores vem do próprio OpenCode.** O `OpencodeCatalogService` lê `opencode.ai/inference[/go]/v1/models` (cache de 1 hora) e substitui o `go.mdx` e o models.dev para esses provedores. É tráfego para o host do provedor configurado, não phone-home: a busca só acontece com o provedor cadastrado. O aquecimento no boot respeita `THINKER_CATALOG_SYNC=false`. Nesse caso o catálogo é buscado no primeiro uso, como o `/models` de qualquer provedor. `raw.githubusercontent.com` sai da lista do ADR 0003.
3. **Cada modelo vai para o endpoint do seu protocolo**, nos dois provedores: `/openai/v1/chat/completions`, `/openai/v1/responses`, `/anthropic/v1/messages` ou `/google/v1beta`. Sem o catálogo, a família do modelo decide.
4. **Modo gratuito.** O provedor OpenCode pode ser conectado sem chave: o Thinker guarda a chave `public`, a descoberta lista só os modelos com preço zero e o proxy envia `Bearer public`. Com uma chave real, todos os modelos aparecem.
5. **O Thinker se identifica como o cliente OpenCode** em toda requisição aos dois provedores (`User-Agent: opencode/...` e `x-opencode-client`, além do `x-opencode-session` que já ia), para qualquer harness. Foi uma escolha explícita do mantenedor. É o mesmo que o Thinker já faz com o User-Agent do Codex CLI na assinatura ChatGPT.
6. **Custo.** OpenCode pago: vale o `usage.cost` que o gateway devolve; sem ele, o preço por token do catálogo com o multiplicador de pico. OpenCode Go: grava o equivalente em dólar consumido da cota, a preço de lista do catálogo Go, e ignora o custo reportado (que é $0 dentro da cota). Modelos gratuitos: $0.
7. **Cota esgotada.** Um 429 cujo corpo traz `FreeUsageLimitError`, `GoUsageLimitError`, `BudgetLimitError`, `CreditLimitExceeded` ou `insufficient_quota` aciona o fallback e põe a rota em espera pelo `Retry-After` inteiro, até 24 horas, em vez do teto de 5 minutos dos 429 comuns.
8. **Login no OpenCode Console** (device code) serve aos dois provedores. Na página do OpenCode Go, o painel mostra o medidor da cota (5 horas, semana e mês) lido de `opencode.ai/zen/go/v1/usage` só quando a página abre.

Ficam de fora: a config remota do Console (`/api/v2/config`, com BYOK, MCP e skills), os budgets do workspace, a busca web, a voz GPT-Live e os modelos SystemOne/Jev do tipo `decision`.

## Riscos

- **Identidade de cliente.** Os modelos gratuitos são oferecidos para o cliente OpenCode. Usar a identidade dele a partir de outros harnesses contraria essa regra. O OpenCode pode bloquear o IP da instância ou passar a exigir sinais que o Thinker não envia. Nesse caso os modelos gratuitos param e o fallback assume.
- **Cota compartilhada.** Todos os agentes atrás de uma instância saem do mesmo IP e usam a mesma cota diária gratuita, cujo critério não é documentado.
- **Dados.** Alguns modelos gratuitos (Big Pickle, MiMo, Flint) podem usar os dados para treinamento. O painel avisa ao oferecer o modo gratuito.

## Consequências

- O custo do OpenCode Go volta a ser gravado (deixa de ser $0), agora a preço de token em vez de estimativa por requisição.
- Configs de harness que ainda usam `opencode-zen/<modelo>` continuam funcionando. Novos snippets publicam `opencode/<modelo>`.
- A lista de destinos de saída do ADR 0003 fica só com `openrouter.ai` e `models.dev`. O teste de egresso (#34) passa a esperar `opencode.ai` apenas com um provedor OpenCode cadastrado.
