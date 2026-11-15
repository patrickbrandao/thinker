# Especificação: simulação pura

> Status: **implementada** (15/11/2026). Os desvios em relação à proposta original estão em [Implementação: desvios e decisões](#implementação-desvios-e-decisões). Para subir: `sim/up.sh`; login em `sim/.state/admin.txt`.

## Objetivo

Rodar um Thinker local **sem nenhum tráfego externo**, com provedores de IA simulados e agentes simulados usando o gateway sem parar, para desenvolver e observar comportamentos: roteamento, fallback, cota esgotada, custos, sessões (inclusive a janela ao vivo), alertas e gráficos. Nada de chave real, crédito real ou dado de produção.

Os provedores simulados vêm do [White Wizard](https://github.com/patrickbrandao/white-wizard) (`wwz`), um servidor em Go que responde no formato exato de cada provedor (texto, raciocínio, tool calls, streaming SSE), com latência, erros, cotas e cobrança simuladas.

## Peças

| Peça | O quê | Endereço |
| --- | --- | --- |
| Mock OpenCode | `wwz` com `sim/wwz/opencode.yaml` (driver `opencode`) | dados `127.0.0.1:18210`, admin `127.0.0.1:18211` |
| Mock OpenAI | `wwz` com `sim/wwz/openai.yaml` (driver `openai`) | dados `127.0.0.1:18220`, admin `127.0.0.1:18221` |
| Thinker de simulação | backend + dashboard novos, banco vazio próprio | API `127.0.0.1:18300`, dashboard `127.0.0.1:18301` |
| PostgreSQL | contêiner descartável `thk-sim-pg` (volume `thk-sim-pg-data`) | `127.0.0.1:18302`, banco `thinker_sim` |
| Catálogos locais | `python3 -m http.server` servindo `sim/.state/catalog/` (gerado por `sim/catalog/build.py`) | `127.0.0.1:18230` |
| Agentes simulados | `wwz-load agents` em laço (`sim/agents/`) | chamam o Thinker em `127.0.0.1:18300` |

Todas as portas ficam em `sim/ports.env` para trocar num lugar só. Nada disso toca na instância do mantenedor (`~/thinker-local`, porta 2099), no PostgreSQL das portas 5432/5433 nem na cópia de produção (`~/thinker-devdata`).

Pré-requisito: o repositório `~/Projects/white-wizard` (variável `WWZ_REPO`) com os binários em `bin/` (`go build -o bin/ ./cmd/wwz ./cmd/wwz-load ./cmd/wwz-tools`). Validado com o commit `be48760`.

## Mock OpenCode (`sim/wwz/opencode.yaml`)

Driver `opencode` na raiz: as bases ficam em `http://127.0.0.1:18210/inference` (pay-as-you-go e gratuitos) e `http://127.0.0.1:18210/inference/go` (plano Go), com `/openai/v1/chat/completions`, `/openai/v1/responses`, `/anthropic/v1/messages`, `/v1/models` e `/v1/usage`, como no `opencode.ai`. O catálogo (`models[]`) é o real, gravado de `opencode.ai` pelo White Wizard (79 modelos pay-as-you-go e 28 do Go); `sim/wwz/gen-opencode.sh` o regenera a partir do exemplo `opencode-completo` do wwz.

| Credencial | Comportamento |
| --- | --- |
| `public` | Modo gratuito sem conta, como o real. Só os modelos gratuitos (`big-pickle`, `*-free`…) respondem, com `User-Agent: opencode/...` e `x-opencode-session` (o Thinker já manda os dois). Modelo pago: 401 `Missing API key.`. Base Go: 401. Cota diária de gratuitos: 500 requisições (`free_requests_per_day`). |
| `sim-opencode-go-quota-key` | Plano Go com cota **minúscula de propósito** (tier `go-tiny`): US$ 0,05/mês por modelo em `deepseek-v4.1-flash`, `glm-5.3-flash`, `kimi-k2.7-code` e `minimax-m3`, com janela de 5 h = 20 % (US$ 0,01) e semanal = 50 %. A cota cai pelo `allowance` (0,6× o preço de lista). Esgotada, o mock responde o erro de cota do Go; `/inference/go/v1/usage` mostra o uso. Para a cota durar mais, aumente os valores em `tiers.go-tiny`. |

Conferido em 15/11/2026: `public` + `big-pickle` → 200 com `reasoning_content`; `public` + `kimi-k3` → 401; `sim-opencode-go-quota-key` com `deepseek-v4.1-flash` e respostas de ~400 tokens esgotou a janela de 5 h na 70ª requisição com 429 `{"type":"error","error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"},"metadata":{…,"limitName":"5 hour"}}`, e `/inference/go/v1/usage` passou a mostrar `rolling` com `status: rate-limited` e `percent: 100`.

## Mock OpenAI (`sim/wwz/openai.yaml`)

Driver `openai` na raiz: `http://127.0.0.1:18220/v1/chat/completions`, `/v1/responses` (com estado, `previous_response_id`) e `/v1/models`.

- Credencial `sk-sim-openai-unlimited-billed-key-0000000000000000000` (prefixo `sk-` e 54 caracteres, para passar na validação de chave da OpenAI no Thinker): **sem crédito, sem teto de gasto e sem limite de taxa**, então nunca acaba; mas toda requisição é **tarifada** pelo `pricing` dos modelos e acumula `spend_usd` na conta e na chave em `GET http://127.0.0.1:18221/admin/entities` (a entidade da chave aparece pelo rótulo, `sim-openai-unlimited`). Conferido em 15/11/2026: 200 com chave válida, 401 `invalid_api_key` com chave errada, `spend_usd` crescendo a cada requisição. Chave errada: 401 `invalid_api_key`.
- Modelos com ids reais (`gpt-5.5`, `gpt-5.5-mini`), para o Thinker precificar pelo próprio catálogo e os dois custos poderem ser comparados.
- Raciocínio em 70 % das respostas e tool calls em 35 %, pelo perfil `generation.agent`: o Thinker não repassa os cabeçalhos `x-wwz-*`, então o agente não consegue pedir ferramentas pela requisição.

## Mudança no Thinker: modo simulação

Os mocks são alcançados pelas **URLs editáveis por conta** ([ADR 0012](../adr/0012-urls-editaveis-por-conta.md), [urls-por-conta.md](urls-por-conta.md)): cada conexão da carga inicial grava `urlOverrides.inference` apontando para o wwz. Não existe variável de troca de origem por provedor. O que o modo simulação acrescenta é a garantia de que nada sai da máquina e catálogos locais para os preços.

### Variáveis

| Variável | Efeito |
| --- | --- |
| `THINKER_SIMULATION=true` | Liga o modo simulação (aceita `true`, `1`, `yes`, `on`). |
| `THINKER_SIM_CATALOG_URLS` | `models_dev=<url>,openrouter=<url>,opencode=<url>`: troca as URLs dos catálogos públicos (`models.dev/api.json`, `openrouter.ai/api/v1/models`, `models.opencode.ai/...`) pelas locais. Lida **só** com `THINKER_SIMULATION=true`; sem ela é ignorada e o boot avisa. Cada URL tem de ser `http(s)` em loopback, `localhost` ou IP privado literal; outra coisa derruba o boot com mensagem clara. Um catálogo não listado continua com a URL pública, que o guarda recusa. |
| `THINKER_CATALOG_SYNC` | Precisa ficar ligada (padrão) para os catálogos locais serem lidos. |

### Regras (como implementadas)

1. **Zero tráfego externo garantido pelo código** (`common/outbound/simulation.ts`). Com `THINKER_SIMULATION=true`, `assertSimulationDestination` recusa todo destino que não seja loopback, `localhost`/`*.localhost` ou rede privada (`isPrivateIp`: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 198.18/15, ::1, fc00::/7, fe80::/10). Um nome é resolvido e **todos** os endereços têm de ser privados. A recusa lança `SimulationEgressBlockedError` (`code: ESIMULATIONBLOCKED`, mensagem `Simulation mode (THINKER_SIMULATION=true): refusing outbound request to <host:porta>; only loopback and private network destinations are allowed`) e registra uma linha de erro no logger `Simulation`. O guarda é chamado em `outboundFetch` (todo o tráfego de provedores, catálogos, OAuth, gatilhos HTTP e e-mail por API), em `fetchViaProxy` (o proxy e o destino), em `pinnedDirectFetch`/`ssrfSafeFetch` e no transporte `node:https` do CIMD; e o boot envolve o `fetch` global (`installSimulationFetchGuard`), então uma chamada que fuja dessas funções também é recusada. Sem a variável nada disso roda (nem um tick a mais de `await`). Fora do HTTP, os transportes de log dos gatilhos (Syslog/GELF/RELP por UDP/TCP) e o SMTP não passam pelo guarda: a carga inicial não cria gatilhos.
2. A redescoberta periódica (`THINKER_DISCOVERY_INTERVAL_HOURS`) e o monitor do Console do OpenCode continuam como em produção: só alcançam as URLs das contas (os mocks) e o que fugir disso é recusado.
3. **Catálogos locais para o custo ser real.** O Thinker não tem API de preço manual: preço vem do models.dev (prioritário, com `cache_read`), do OpenRouter (sem preço de cache) e do catálogo do OpenCode. `sim/catalog/models-dev.json` e `sim/catalog/openrouter.json` têm `gpt-5.5` (1,25 / 10 / cache 0,125 por milhão) e `gpt-5.5-mini` (0,25 / 2 / 0,025), iguais ao `pricing` de `sim/wwz/openai.yaml`. `sim/catalog/build.py` (rodado pelo `up.sh`) junta a eles os provedores `opencode` e `opencode-go` lidos do wwz (`/inference[/go]/v1/models`, os mesmos registros do catálogo real) e gera em `sim/.state/catalog/` o `models-dev.json`, o `openrouter.json` e o `opencode.json` (documento models.dev v2 no formato de `models.opencode.ai`).
4. O boot registra em destaque `SIMULATION MODE: providers are simulated, no external traffic` e a lista de catálogos simulados; `GET /api/v1/health` responde `simulation: true` (o campo só existe com o modo ligado); o dashboard mostra o selo **Simulation** (pt-BR: Simulação, tom `warn`) na barra superior, lido do health (`services/simulation.ts`).
5. Nenhuma outra mudança de comportamento: adapters, cabeçalhos (`User-Agent` do OpenCode, `x-opencode-session`), validação de chaves e regras de roteamento são os de produção.

### Custo: Thinker × wwz

As duas pontas calculam o mesmo valor exato por requisição: `c = (prompt − cached) × input + cached × cache_read + completion × output` (o `completion` já inclui os tokens de raciocínio; os preços são por token). A diferença está só no arredondamento de cada requisição:

- Thinker grava `round(c, 6)` em `agent_messages.cost_usd` (`decimal(10,6)`, meio para cima);
- wwz debita `floor(c × 10⁶) / 10⁶` (micro-dólares inteiros, truncados) em `spend_usd`.

Logo `Σ Thinker − spend_usd` fica entre 0 e 1 µUSD por requisição (em média ~0,5 µUSD). Conferido em 15/11/2026 com 74 requisições na chave da OpenAI (66 do `sim-codex` e 8 de fallback do `sim-opencode-go`): `spend_usd` do wwz = 0,101115; a soma de `floor` calculada dos tokens gravados pelo Thinker = 0,101115 (idêntica até o micro-dólar: tokens e preços batem); a soma exata = 0,10114675; o total do Thinker = 0,101156. Igualdade exata exigiria que um dos lados mudasse o arredondamento, o que a simulação não faz (regra 5 e "não mudar o código do wwz").

## Thinker de simulação

Uma instância nova, contendo **só o necessário**:

- PostgreSQL descartável `thk-sim-pg` (imagem `postgres:18-alpine`, ou `THINKER_SIM_PG_IMAGE`) com banco vazio (`thinker_sim`) no volume `thk-sim-pg-data`, sem `SEED_DATA`.
- Backend do repositório (`node dist/main`, compilado pelo `up.sh`; `SIM_SKIP_BUILD=1` pula a compilação) com o ambiente gerado uma vez por `sim/up.sh` em `sim/.state/env` (600): segredos aleatórios locais (`BETTER_AUTH_SECRET`, `THINKER_ENCRYPTION_KEY`, `THINKER_SETUP_TOKEN`, senha do Postgres), `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`DATABASE_UNPOOLED_URL` do contêiner, `THINKER_SIMULATION=true`, `THINKER_SIM_CATALOG_URLS`, `THINKER_CATALOG_SYNC=true`, `THINKER_RECORDING_STORAGE=filesystem` em `sim/.state/rec`, `MCP_ENABLED=false`.
- Dashboard pelo Vite (`VITE_BACKEND_PORT=18300`, `127.0.0.1:18301`).
- `sim/.state/` fica fora do git.

### Carga inicial (`sim/seed.sh`)

Pela API pública do Thinker, sem SQL direto (pode ser repetida: harness existente ganha chave nova, conexão existente é mantida):

1. Admin pelo `/setup` (`POST /api/v1/setup/admin` com o `THINKER_SETUP_TOKEN`): `admin@sim.local` com senha gerada, gravada em `sim/.state/admin.txt` (600), e login por `POST /api/auth/sign-in/email`.
2. Três harnesses (`POST /api/v1/agents`, categoria `coding`, gravação ligada), com as chaves `thk_` em `sim/.state/keys.env` (`SIM_OPENCODE_FREE_KEY`, `SIM_OPENCODE_GO_KEY`, `SIM_CODEX_KEY`):

| Harness | Tipo | Rota `default` | Fallback | Para observar |
| --- | --- | --- | --- | --- |
| `sim-opencode-free` | OpenCode | OpenCode `public`, `opencode/big-pickle` | — | modelos gratuitos, cota diária |
| `sim-opencode-go` | OpenCode | OpenCode Go `sim-opencode-go-quota-key`, `opencode-go/deepseek-v4.1-flash` | OpenAI `gpt-5.5-mini` | cota Go esgotando e o fallback para a OpenAI |
| `sim-codex` | Codex | OpenAI `gpt-5.5` | — | tarifação sem limite, raciocínio, tool calls |

3. As conexões (da organização, por `POST /api/v1/routing/sim-opencode-free/providers`; os harnesses criados depois as herdam): OpenCode com a chave `public` e `urlOverrides.inference = http://127.0.0.1:18210/inference`; OpenCode Go com `sim-opencode-go-quota-key` e `…/inference/go`; OpenAI com `sk-sim-openai-unlimited-billed-key-0000000000000000000` e `http://127.0.0.1:18220`. As chaves passam na validação do Thinker (`minKeyLength: 20` no OpenCode/Go; `sk-` e 50+ no OpenAI; `public` é a chave gratuita aceita pelo formulário, ADR 0009, e o backend não valida tamanho).
4. Rotas pelo `PUT /api/v1/routing/:agent/tiers/default`, fallback por `PUT …/tiers/default/fallbacks`, gravação por `PATCH …/recording`. Os agentes pedem o modelo `auto`, que segue o tier `default`.

## Agentes simulados (`sim/agents/`)

Cada agente é um laço infinito com pausas discretas, que roda uma sessão de cada vez com o `wwz-load agents`:

```text
enquanto não interrompido:
  sessão = sim-<agente>-<data>-<n>
  wwz-load agents --target http://127.0.0.1:18300 --protocol openai --stream \
    --key <thk_ do harness> --model auto --profile <perfil> --agents 1 --sessions 1 \
    --turns <T> --max-tool-rounds 4 --think-time <pausa entre turnos> \
    --header "x-session-key: <sessão>" --header "user-agent: <UA do harness>" \
    --retries 0 --progress 0 --output json --out sim/.state/agents/<agente>/<sessão>.json
  dorme um tempo aleatório entre <pausa mínima> e <pausa máxima>
```

- `sim/agents/agents.conf`, uma linha por agente: nome, harness (chave em `keys.env`), modelo (`auto`), perfil do `wwz-load` (`coder`, `pesquisa`, `chat`), turnos, pausa entre turnos, pausas mínima/máxima entre sessões e o `User-Agent`. Padrão: um agente por harness da carga inicial (`sim-opencode-free` com `chat`, 2 turnos, 10–30 s; `sim-opencode-go` com `coder`, 3 turnos, 5–15 s; `sim-codex` com `pesquisa`, 3 turnos, 15–45 s).
- `sim/agents/run.sh` sobe um laço por linha em segundo plano, escreve o PID em `sim/.state/agents/pids` e uma linha de progresso por sessão em `sim/.state/agents/<agente>.log`; `sim/agents/stop.sh` encerra todos.
- As ferramentas pedidas pelo modelo são executadas pelo catálogo falso do `wwz-tools`, dentro do processo do `wwz-load`. O resultado volta na conversa, então o Thinker vê o ciclo completo: prompt, tool call, tool result, resposta.
- `--retries 0` deixa as falhas visíveis no Thinker (quem tenta de novo é o fallback do gateway, não o agente).
- `x-session-key` muda a cada sessão, então cada sessão aparece separada em Sessões e pode ser acompanhada pela janela ao vivo.
- O `User-Agent` imita o harness (`opencode/...` nos dois do OpenCode, `codex_cli_rs/...` no Codex), para a classificação do chamador do Thinker funcionar como com o cliente real.

## Orquestração

| Script | O que faz |
| --- | --- |
| `sim/up.sh` | Confere os binários do wwz (`WWZ_REPO`, padrão `~/Projects/white-wizard`), gera o `sim/.state/env` na primeira vez, sobe os dois mocks (logs em `sim/.state/logs/`), gera e serve os catálogos locais, o Postgres, compila e sobe o backend e o Vite, roda o `seed.sh` na primeira vez e inicia os agentes. Idempotente: o que já está de pé fica. |
| `sim/down.sh` | Para agentes, Vite, backend, servidor de catálogos e mocks; mantém o Postgres e o `sim/.state/` (dados preservados). |
| `sim/reset.sh` | `down.sh` mais a remoção do contêiner `thk-sim-pg`, do volume `thk-sim-pg-data` e de `sim/.state/`. |
| `sim/status.sh` | Uma linha por peça (de pé ou não, porta), as últimas sessões de cada agente, o `spend_usd` de cada wwz (`/admin/entities`) e a cota restante do `sim-opencode-go-quota-key` (`/inference/go/v1/usage` com `x-opencode-session`). |
| `sim/seed.sh` | A carga inicial (acima); `up.sh` roda uma vez e marca `sim/.state/seeded`. |

Os scripts são compatíveis com o bash 3.2 do macOS e usam `curl`, `jq`, `python3`, `openssl`, `lsof` e `docker`. Os PIDs ficam em `sim/.state/pids/`; o `down.sh` só encerra processos iniciados deste checkout.

Também entram em `.claude/launch.json` (local, fora do git) as configurações `sim-backend`, `sim-web`, `sim-wwz-opencode` e `sim-wwz-openai`, para o app do Claude abrir o dashboard no navegador embutido.

## O que observar

| Comportamento | Como provocar | Onde ver no Thinker |
| --- | --- | --- |
| Streaming, raciocínio e ferramentas ao vivo | agentes rodando | Sessões → "Watch live" (abas Chat, Detalhes e Inspetor) |
| Modelos gratuitos do OpenCode | `sim-opencode-free` | Requisições com custo zero; conta OpenCode |
| Cota Go esgotando e fallback | `sim-opencode-go` (a cota de 5 h acaba em ~70 requisições de ~400 tokens) | Erro de cota na tentativa 1 e tentativa 2 na OpenAI (janela ao vivo e Requisições); medidor de uso do OpenCode Go; status da rota em Roteamento |
| Tarifação sem limite | `sim-codex` | Custo por requisição e totais no Thinker comparados com o `spend_usd` em `/admin/entities` do wwz da OpenAI |
| Falhas e caos | cabeçalhos ou perfis de erro do wwz (`errors:` no YAML, ou `/admin` do wwz) | Alertas, taxa de sucesso, eventos `route.out_of_service` |

## Critérios de aceite

1. `sim/up.sh` num checkout limpo deixa tudo de pé e, em até 2 minutos, Sessões mostra sessões dos três agentes. **Conferido:** primeira sessão de cada agente em menos de 30 s depois do `up.sh`; `GET /api/v1/sessions` com sessões de `sim-opencode-free`, `sim-opencode-go` e `sim-codex`.
2. Com o modo simulação ligado, nenhum pacote sai da máquina para fora de loopback e redes privadas. **Conferido:** testes unitários (`common/outbound/simulation.spec.ts`: `outboundFetch`, `ssrfSafeFetch`, `pinnedDirectFetch` e o `fetch` global recusam host público sem chamar a rede); ao vivo, `POST /api/v1/routing/sim-codex/custom-providers/probe` com `https://api.openai.com/v1` responde 400 com a mensagem do guarda e o log registra `Outbound request refused`; durante a carga, essa foi a única recusa no log e as conexões TCP do backend eram só para `127.0.0.1`.
3. A cota do `sim-opencode-go` esgota e o Thinker cai para a OpenAI sem erro para o agente. **Conferido:** tentativa 1 em `opencode-go` com 429 `GoUsageLimitError` e tentativa 2 em `openai/gpt-5.5-mini` com sucesso na mesma requisição; os relatórios do `wwz-load` dessas sessões com `failed: 0` e `errors: 0`. Depois do primeiro 429 o Thinker põe a rota em espera (429 "Provider route temporarily cooling down") e vai direto ao fallback.
4. O custo do `sim-codex` no Thinker bate com o `spend_usd` da chave no admin do wwz da OpenAI (mesmos preços). **Conferido** dentro do arredondamento descrito em [Custo: Thinker × wwz](#custo-thinker--wwz) (≤ 1 µUSD por requisição).
5. Sem `THINKER_SIMULATION`, nenhum comportamento muda: as suítes atuais passam sem alteração, e testes provam que o guarda e `THINKER_SIM_CATALOG_URLS` são inertes (`catalogUrl` devolve a URL pública, `applySimulationMode` não instala nada, `/health` não traz o campo).
6. `sim/down.sh` seguido de `sim/up.sh` retoma com os dados preservados; `sim/reset.sh` volta ao zero. **Conferido** (contagens de harnesses, mensagens e sessões iguais antes e depois de `down`/`up`).

## Implementação: desvios e decisões

- **Sem `THINKER_SIM_BASE_URLS`.** As contas apontam para os mocks pelas URLs por conta (v0.38, ADR 0012). Com isso a regra 3 da proposta (catálogo do OpenCode vindo do wwz) é coberta por `THINKER_SIM_CATALOG_URLS` (`opencode=`) e pelos `models` derivados de cada conta.
- **Catálogos ligados, não desligados.** A proposta desligava `THINKER_CATALOG_SYNC`; sem catálogo o Thinker não precifica (não há preço manual), então a sincronização fica ligada e lê catálogos locais.
- **Credenciais renomeadas** para passar na validação de chave do Thinker: `sim-opencode-go-quota-key` e `sk-sim-openai-unlimited-billed-key-0000000000000000000`.
- **Ids dos modelos do OpenCode** nas rotas levam o prefixo do provedor (`opencode/big-pickle`, `opencode-go/deepseek-v4.1-flash`), como a descoberta os lista.
- **Agentes pedem `auto`**, para a rota `default` (e o fallback) do harness valer.
- **Custo**: igualdade dentro do arredondamento por requisição, não igualdade exata (ver acima).

## Fora do escopo

- Simular as assinaturas por OAuth (ChatGPT, Claude): o wwz tem o modo assinatura do Claude Code, que fica para depois.
- Rodar a simulação em Docker Compose: primeiro o modo local com scripts.
- Mudar os mocks do wwz: configurações novas, sim; código do White Wizard, não.
