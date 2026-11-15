# Especificação: simulação para avaliar o Thinker

> Status: **implementada** (15/11/2026; revista no mesmo dia para tirar o modo simulação do produto). Para subir: `sim/up.sh`; login em `sim/.state/admin.txt`; medidas: `sim/metrics.sh`.

## Objetivo

Avaliar o comportamento do Thinker sob uso contínuo e controlado: funcionamento dos recursos (roteamento, fallback, cota esgotada, custos, sessões e janela ao vivo, gravações, alertas, gráficos), consumo de CPU e memória, acúmulo de arquivos e espaço em disco, crescimento do banco, latência e taxa de erro.

**O Thinker roda exatamente como em produção.** Não existe modo simulação, variável de ambiente especial nem selo na interface. A simulação acontece só nos dados:

- **Provedores simulados:** contas comuns cujas URLs ([URLs editáveis por conta](urls-por-conta.md), ADR 0012) apontam para o [White Wizard](https://github.com/patrickbrandao/white-wizard) (`wwz`), um servidor em Go que responde no formato exato de cada provedor (texto, raciocínio, tool calls, streaming SSE), com latência, erros, cotas e cobrança simuladas.
- **Agentes simulados:** um cliente (`wwz-load agents`) usando as chaves de harnesses comuns, em laço, com pausas.

A mesma instância aceita provedores e harnesses reais lado a lado: basta cadastrar uma conta real ou apontar um harness real para ela.

## Peças

| Peça | O quê | Endereço |
| --- | --- | --- |
| Mock OpenCode | `wwz` com `sim/wwz/opencode.yaml` (driver `opencode`) | dados `127.0.0.1:18210`, admin `127.0.0.1:18211` |
| Mock OpenAI | `wwz` com `sim/wwz/openai.yaml` (driver `openai`) | dados `127.0.0.1:18220`, admin `127.0.0.1:18221` |
| Thinker | backend + dashboard deste checkout, banco vazio próprio | API `127.0.0.1:18300`, dashboard `127.0.0.1:18301` |
| PostgreSQL | contêiner descartável `thk-sim-pg` (volume `thk-sim-pg-data`) | `127.0.0.1:18302`, banco `thinker_sim` |
| Agentes | `wwz-load agents` em laço (`sim/agents/`) | chamam o Thinker em `127.0.0.1:18300` |

As portas ficam em `sim/ports.env`. Nada disso toca na instância do mantenedor (`~/thinker-local`, porta 2099), no PostgreSQL das portas 5432/5433 nem na cópia de produção (`~/thinker-devdata`).

Pré-requisito: `~/Projects/white-wizard` (variável `WWZ_REPO`) com os binários em `bin/` (`go build -o bin/ ./cmd/wwz ./cmd/wwz-load ./cmd/wwz-tools`). Validado com o commit `be48760`.

## Mock OpenCode (`sim/wwz/opencode.yaml`)

Driver `opencode` na raiz: as bases ficam em `http://127.0.0.1:18210/inference` (pay-as-you-go e gratuitos) e `http://127.0.0.1:18210/inference/go` (plano Go), com `/openai/v1/chat/completions`, `/openai/v1/responses`, `/anthropic/v1/messages`, `/v1/models` e `/v1/usage`, como no `opencode.ai`. O catálogo (`models[]`) é o real, gravado de `opencode.ai` pelo White Wizard (79 modelos pay-as-you-go e 28 do Go); `sim/wwz/gen-opencode.sh` o regenera a partir do exemplo `opencode-completo` do wwz.

| Credencial | Comportamento |
| --- | --- |
| `public` | Modo gratuito sem conta, como o real. Só os modelos gratuitos (`big-pickle`, `*-free`…) respondem, com `User-Agent: opencode/...` e `x-opencode-session` (o Thinker já manda os dois). Modelo pago: 401 `Missing API key.`. Base Go: 401. Cota diária de gratuitos: 500 requisições (`free_requests_per_day`). |
| `sim-opencode-go-quota-key` | Plano Go com cota **minúscula de propósito** (tier `go-tiny`): US$ 0,05/mês por modelo em `deepseek-v4.1-flash`, `glm-5.3-flash`, `kimi-k2.7-code` e `minimax-m3`, com janela de 5 h = 20 % (US$ 0,01) e semanal = 50 %. A cota cai pelo `allowance` (0,6× o preço de lista). Esgotada, o mock responde 429 `GoUsageLimitError`; `/inference/go/v1/usage` mostra o uso. Para a cota durar mais, aumente os valores em `tiers.go-tiny`. |

As chaves passam na validação do Thinker (`minKeyLength: 20` no OpenCode e no Go; `public` é a chave gratuita, ADR 0009).

## Mock OpenAI (`sim/wwz/openai.yaml`)

Driver `openai` na raiz: `http://127.0.0.1:18220/v1/chat/completions`, `/v1/responses` (com estado, `previous_response_id`) e `/v1/models`.

- Credencial `sk-sim-openai-unlimited-billed-key-0000000000000000000` (prefixo `sk-` e 50+ caracteres, como o Thinker exige da OpenAI): **sem crédito, sem teto de gasto e sem limite de taxa**, então nunca acaba; mas toda requisição é **tarifada** pelo `pricing` dos modelos e acumula `spend_usd` em `GET http://127.0.0.1:18221/admin/entities` (a chave aparece pelo rótulo, `sim-openai-unlimited`).
- Modelos com ids reais (`gpt-5.5`, `gpt-5.5-mini`), para o Thinker precificar pelo próprio catálogo.
- Raciocínio em 70 % das respostas e tool calls em 35 %, pelo perfil `generation.agent`: o Thinker não repassa os cabeçalhos `x-wwz-*`, então o agente não consegue pedir ferramentas pela requisição.

### Custo: Thinker × wwz

O Thinker precifica pelos catálogos públicos de sempre (models.dev e OpenRouter, ADR 0003). O custo de uma requisição só bate com o `spend_usd` do wwz quando o `pricing` de `sim/wwz/openai.yaml` é igual ao preço que o Thinker usa para o modelo (página **Preços de modelos**). Com preços iguais, as duas pontas calculam `c = (prompt − cached) × input + cached × cache_read + completion × output` (o `completion` inclui o raciocínio) e diferem só no arredondamento: o Thinker grava `round(c, 6)`, o wwz debita `floor(c × 10⁶) / 10⁶`, ou seja, no máximo 1 µUSD por requisição. Conferido em 15/11/2026 com preços iguais: 85 requisições, wwz US$ 0,098844 e Thinker US$ 0,098903.

## Thinker

Uma instância nova, contendo só o necessário, configurada como qualquer instalação:

- PostgreSQL descartável `thk-sim-pg` (imagem `postgres:18-alpine`, ou `THINKER_SIM_PG_IMAGE`) com banco vazio (`thinker_sim`) no volume `thk-sim-pg-data`, sem `SEED_DATA`.
- Backend deste checkout (`node dist/main`, compilado pelo `up.sh`; `SIM_SKIP_BUILD=1` pula a compilação) com o ambiente gerado uma vez em `sim/.state/env` (600): segredos aleatórios locais (`BETTER_AUTH_SECRET`, `THINKER_ENCRYPTION_KEY`, `THINKER_SETUP_TOKEN`, senha do Postgres), as URLs do banco, gravação em arquivo (`THINKER_RECORDING_STORAGE=filesystem` em `sim/.state/rec`) e `MCP_ENABLED=false`. Nenhuma variável fora das de uma instalação normal.
- Dashboard pelo Vite (`VITE_BACKEND_PORT=18300`, `127.0.0.1:18301`).
- `sim/.state/` fica fora do git.

### Carga inicial (`sim/seed.sh`)

Pela API pública, sem SQL direto (pode ser repetida):

1. Admin pelo `/setup` com o `THINKER_SETUP_TOKEN`: `admin@sim.local`, senha gerada em `sim/.state/admin.txt` (600).
2. Três harnesses comuns (gravação ligada), com as chaves `thk_` em `sim/.state/keys.env`:

| Harness | Tipo | Rota `default` | Fallback | Para observar |
| --- | --- | --- | --- | --- |
| `sim-opencode-free` | OpenCode | OpenCode `public`, `opencode/big-pickle` | — | modelos gratuitos, cota diária |
| `sim-opencode-go` | OpenCode | OpenCode Go `sim-opencode-go-quota-key`, `opencode-go/deepseek-v4.1-flash` | OpenAI `gpt-5.5-mini` | cota Go esgotando e o fallback |
| `sim-codex` | Codex | OpenAI `gpt-5.5` | — | tarifação, raciocínio, tool calls |

3. Três contas comuns com URLs por conta: OpenCode (`public`, `inference = http://127.0.0.1:18210/inference`), OpenCode Go (`sim-opencode-go-quota-key`, `…/inference/go`) e OpenAI (`sk-sim-…`, `http://127.0.0.1:18220`).
4. Rotas pelo `PUT /api/v1/routing/:agent/tiers/default`, fallback por `…/tiers/default/fallbacks`, gravação por `PATCH …/recording`. Os agentes pedem `auto`.

## Agentes (`sim/agents/`)

Cada agente é um laço infinito com pausas, uma sessão de cada vez:

```text
enquanto não interrompido:
  sessão = sim-<agente>-<data>-<n>
  wwz-load agents --target http://127.0.0.1:18300 --protocol openai --stream \
    --key <thk_ do harness> --model auto --profile <perfil> --agents 1 --sessions 1 \
    --turns <T> --max-tool-rounds 4 --think-time <pausa entre turnos> \
    --header "x-session-key: <sessão>" --header "user-agent: <UA do harness>" \
    --retries 0 --progress 0 --output json --out sim/.state/agents/<agente>/<sessão>.json
  dorme entre <pausa mínima> e <pausa máxima>
```

- `sim/agents/agents.conf`: uma linha por agente (nome, harness, modelo, perfil `coder`/`pesquisa`/`chat`, turnos, pausa entre turnos, pausas entre sessões, `User-Agent`). Para mais carga, acrescente linhas ou encurte as pausas.
- `sim/agents/run.sh` sobe os laços (PIDs em `sim/.state/agents/pids`, progresso em `sim/.state/agents/<agente>.log`); `sim/agents/stop.sh` encerra.
- As ferramentas pedidas pelo modelo são executadas pelo catálogo falso do `wwz-tools`, dentro do `wwz-load`; o Thinker vê o ciclo completo.
- `--retries 0` deixa as falhas visíveis no Thinker (quem tenta de novo é o fallback do gateway).
- O `x-session-key` muda a cada sessão; o `User-Agent` imita o harness.

## Orquestração

| Script | O que faz |
| --- | --- |
| `sim/up.sh` | Confere os binários do wwz, gera o `sim/.state/env` na primeira vez, sobe os dois mocks, o Postgres, compila e sobe o backend e o Vite, roda o `seed.sh` na primeira vez e inicia os agentes. Idempotente. |
| `sim/down.sh` | Para agentes, Vite, backend e mocks; mantém o Postgres e o `sim/.state/`. |
| `sim/reset.sh` | `down.sh` mais a remoção do contêiner, do volume e de `sim/.state/`. |
| `sim/status.sh` | Peças de pé, últimas sessões de cada agente, `spend_usd` das chaves e contas de cada wwz (as entidades por sessão viram uma contagem) e a cota restante do Go. |
| `sim/metrics.sh` | Medidas para a avaliação (abaixo). |
| `sim/seed.sh` | A carga inicial; `up.sh` roda uma vez e marca `sim/.state/seeded`. |

Scripts compatíveis com o bash 3.2 do macOS; usam `curl`, `jq`, `openssl`, `lsof` e `docker`. O `.claude/launch.json` local tem `sim-backend`, `sim-web`, `sim-wwz-opencode` e `sim-wwz-openai` para o navegador embutido.

## Avaliação

### Medidas (`sim/metrics.sh`)

`sim/metrics.sh` mostra um retrato; `sim/metrics.sh watch [segundos]` (padrão 60) grava uma linha por intervalo em `sim/.state/metrics.csv` para acompanhar a tendência. `WINDOW_MIN` (padrão 5) é a janela das medidas de requisição.

| Grupo | Medida | Fonte |
| --- | --- | --- |
| CPU e memória | `%cpu` e RSS do backend, do Vite e de cada wwz; CPU e memória do Postgres | `ps` pelos PIDs de `sim/.state/pids`, `docker stats` |
| Banco | tamanho do banco e das tabelas `requests` e `agent_messages`; total de tentativas gravadas | `pg_database_size`, `pg_total_relation_size` |
| Disco | `sim/.state` inteiro; gravações (KB e número de arquivos); logs; relatórios dos agentes | `du`, `find` |
| Requisições | tentativas e falhas na janela; duração p50/p95/p99; custo | `agent_messages` (`duration_ms`, `status`, `cost_usd`) |

### Roteiro

1. **Linha de base:** `sim/up.sh`, esperar 10 minutos com os agentes padrão e registrar `sim/metrics.sh watch` desde o início.
2. **Recursos:** com a carga constante, CPU e memória do backend devem ficar estáveis (sem subir sem parar); um crescimento contínuo de RSS indica vazamento.
3. **Acúmulo:** banco, gravações e relatórios crescem com o número de requisições; comparar o KB por requisição ao longo do tempo. A limpeza diária (02:00) apaga gravações e zera corpos expirados pela retenção (padrão 30 dias; para testar, reduza a retenção do harness).
4. **Latência:** comparar a duração no Thinker com a latência configurada nos perfis do wwz; a diferença é o custo do gateway.
5. **Recursos funcionais:** conferir na interface cada linha de "O que observar".
6. **Carga maior:** dobrar os agentes em `agents.conf` (ou encurtar as pausas) e repetir 1 a 4.
7. **Falhas:** ligar erros nos perfis do wwz (`errors:` no YAML, por exemplo uma taxa de 5xx) e observar fallback, status de rota, alertas e taxa de erro.

### O que observar

| Comportamento | Como provocar | Onde ver no Thinker |
| --- | --- | --- |
| Streaming, raciocínio e ferramentas ao vivo | agentes rodando | Sessões → "Watch live" (abas Chat, Detalhes e Inspetor) |
| Modelos gratuitos do OpenCode | `sim-opencode-free` | Requisições com custo zero; conta OpenCode |
| Cota Go esgotando e fallback | `sim-opencode-go` (a janela de 5 h acaba em ~70 requisições de ~400 tokens) | Tentativa 1 com 429 e tentativa 2 na OpenAI (detalhe da requisição, janela ao vivo); medidor de uso do OpenCode Go; status da rota em Roteamento |
| Tarifação | `sim-codex` | Custo por requisição e totais no Thinker × `spend_usd` do wwz da OpenAI |
| Falhas e caos | perfis de erro do wwz | Alertas, taxa de sucesso, `route.out_of_service` |
| Provedores e harnesses reais lado a lado | cadastrar uma conta real ou apontar um harness real | As mesmas telas; nada muda na instância |

## Critérios de aceite

1. `sim/up.sh` num checkout limpo deixa tudo de pé e, em até 2 minutos, Sessões mostra sessões dos três agentes. **Conferido.**
2. O Thinker roda sem nenhuma variável ou código de simulação: o código de produto é o mesmo de uma instalação normal. **Conferido** (o modo simulação da v0.39.0 foi removido).
3. A cota do `sim-opencode-go` esgota e o Thinker cai para a OpenAI sem erro para o agente. **Conferido:** tentativa 1 em `opencode-go` com 429 `GoUsageLimitError` e tentativa 2 em `openai/gpt-5.5-mini` com 200; relatórios do `wwz-load` com `failed: 0`.
4. Com preços iguais nas duas pontas, o custo no Thinker bate com o `spend_usd` do wwz dentro de 1 µUSD por requisição. **Conferido.**
5. `sim/metrics.sh` mostra CPU e memória das peças, banco, disco, latência e taxa de erro, e o modo `watch` grava a série em CSV. **Conferido.**
6. `sim/down.sh` seguido de `sim/up.sh` retoma com os dados preservados; `sim/reset.sh` volta ao zero. **Conferido.**

## Histórico

- A primeira versão (v0.39.0) tinha um modo simulação no produto (`THINKER_SIMULATION`, `THINKER_SIM_CATALOG_URLS`, selo "Simulation"), que bloqueava tráfego externo e servia catálogos locais. Ele foi removido: a instância precisa rodar como em produção e aceitar provedores e harnesses reais; a simulação é só uma questão de contas e agentes.

## Fora do escopo

- Simular as assinaturas por OAuth (ChatGPT, Claude): o wwz tem o modo assinatura do Claude Code, que fica para depois.
- Rodar a simulação em Docker Compose: primeiro o modo local com scripts.
- Mudar o código do White Wizard: configurações novas, sim.
