# Especificação: simulação pura

> Status: **proposta**. As configurações dos provedores simulados já existem e foram validadas (`sim/wwz/`); o resto desta especificação ainda será implementado.

## Objetivo

Rodar um Thinker local **sem nenhum tráfego externo**, com provedores de IA simulados e agentes simulados usando o gateway sem parar, para desenvolver e observar comportamentos: roteamento, fallback, cota esgotada, custos, sessões (inclusive a janela ao vivo), alertas e gráficos. Nada de chave real, crédito real ou dado de produção.

Os provedores simulados vêm do [White Wizard](https://github.com/patrickbrandao/white-wizard) (`wwz`), um servidor em Go que responde no formato exato de cada provedor (texto, raciocínio, tool calls, streaming SSE), com latência, erros, cotas e cobrança simuladas.

## Peças

| Peça | O quê | Endereço |
| --- | --- | --- |
| Mock OpenCode | `wwz` com `sim/wwz/opencode.yaml` (driver `opencode`) | dados `127.0.0.1:18210`, admin `127.0.0.1:18211` |
| Mock OpenAI | `wwz` com `sim/wwz/openai.yaml` (driver `openai`) | dados `127.0.0.1:18220`, admin `127.0.0.1:18221` |
| Thinker de simulação | backend + dashboard novos, banco vazio próprio | API `127.0.0.1:18300`, dashboard `127.0.0.1:18301` |
| PostgreSQL | contêiner descartável `thk-sim-pg` | `127.0.0.1:18302`, banco `thinker_sim` |
| Agentes simulados | `wwz-load agents` em laço (`sim/agents/`) | chamam o Thinker em `127.0.0.1:18300` |

Todas as portas ficam em `sim/ports.env` para trocar num lugar só. Nada disso toca na instância do mantenedor (`~/thinker-local`, porta 2099), no PostgreSQL das portas 5432/5433 nem na cópia de produção (`~/thinker-devdata`).

Pré-requisito: o repositório `~/Projects/white-wizard` (variável `WWZ_REPO`) com os binários em `bin/` (`go build -o bin/ ./cmd/wwz ./cmd/wwz-load ./cmd/wwz-tools`). Validado com o commit `be48760`.

## Mock OpenCode (`sim/wwz/opencode.yaml`)

Driver `opencode` na raiz: as bases ficam em `http://127.0.0.1:18210/inference` (pay-as-you-go e gratuitos) e `http://127.0.0.1:18210/inference/go` (plano Go), com `/openai/v1/chat/completions`, `/openai/v1/responses`, `/anthropic/v1/messages`, `/v1/models` e `/v1/usage`, como no `opencode.ai`. O catálogo (`models[]`) é o real, gravado de `opencode.ai` pelo White Wizard (79 modelos pay-as-you-go e 28 do Go); `sim/wwz/gen-opencode.sh` o regenera a partir do exemplo `opencode-completo` do wwz.

| Credencial | Comportamento |
| --- | --- |
| `public` | Modo gratuito sem conta, como o real. Só os modelos gratuitos (`big-pickle`, `*-free`…) respondem, com `User-Agent: opencode/...` e `x-opencode-session` (o Thinker já manda os dois). Modelo pago: 401 `Missing API key.`. Base Go: 401. Cota diária de gratuitos: 500 requisições (`free_requests_per_day`). |
| `sim-opencode-go` | Plano Go com cota **minúscula de propósito** (tier `go-tiny`): US$ 0,05/mês por modelo em `deepseek-v4.1-flash`, `glm-5.3-flash`, `kimi-k2.7-code` e `minimax-m3`, com janela de 5 h = 20 % (US$ 0,01) e semanal = 50 %. A cota cai pelo `allowance` (0,6× o preço de lista). Esgotada, o mock responde o erro de cota do Go; `/inference/go/v1/usage` mostra o uso. Para a cota durar mais, aumente os valores em `tiers.go-tiny`. |

Conferido em 15/11/2026: `public` + `big-pickle` → 200 com `reasoning_content`; `public` + `kimi-k3` → 401; `sim-opencode-go` com `deepseek-v4.1-flash` e respostas de ~400 tokens esgotou a janela de 5 h na 70ª requisição com 429 `{"type":"error","error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"},"metadata":{…,"limitName":"5 hour"}}`, e `/inference/go/v1/usage` passou a mostrar `rolling` com `status: rate-limited` e `percent: 100`.

## Mock OpenAI (`sim/wwz/openai.yaml`)

Driver `openai` na raiz: `http://127.0.0.1:18220/v1/chat/completions`, `/v1/responses` (com estado, `previous_response_id`) e `/v1/models`.

- Credencial `sim-openai-key`: **sem crédito, sem teto de gasto e sem limite de taxa**, então nunca acaba; mas toda requisição é **tarifada** pelo `pricing` dos modelos e acumula `spend_usd` na conta e na chave em `GET http://127.0.0.1:18221/admin/entities` (a entidade da chave aparece pelo rótulo, `sim-openai-unlimited`). Conferido em 15/11/2026: 200 com chave válida, 401 `invalid_api_key` com chave errada, `spend_usd` crescendo a cada requisição. Chave errada: 401 `invalid_api_key`.
- Modelos com ids reais (`gpt-5.5`, `gpt-5.5-mini`), para o Thinker precificar pelo próprio catálogo e os dois custos poderem ser comparados.
- Raciocínio em 70 % das respostas e tool calls em 35 %, pelo perfil `generation.agent`: o Thinker não repassa os cabeçalhos `x-wwz-*`, então o agente não consegue pedir ferramentas pela requisição.

## Mudança no Thinker: modo simulação

Hoje os endereços do OpenCode (`https://opencode.ai/inference`, `/inference/go` e o catálogo em `models.opencode.ai`) e da OpenAI (`https://api.openai.com`) estão fixos em `routing/proxy/provider-endpoints.ts` e em `model-discovery/`. A simulação precisa trocá-los sem mudar o comportamento de produção.

### Variáveis

| Variável | Efeito |
| --- | --- |
| `THINKER_SIMULATION=true` | Liga o modo simulação. Sem ela, as variáveis abaixo são ignoradas (e o boot registra um aviso se existirem). |
| `THINKER_SIM_BASE_URLS` | Lista `provedor=url` separada por vírgula, por exemplo `opencode=http://127.0.0.1:18210,openai=http://127.0.0.1:18220`. A URL é a **origem** que substitui a do provedor real; o caminho do provedor é mantido (`/inference`, `/inference/go`, `/v1/...`). Primeira entrega: `opencode` (vale também para `opencode-go` e o catálogo) e `openai` (só a conta por chave de API; a assinatura ChatGPT fica de fora). Depois, outros drivers do wwz (`anthropic`, `openrouter`, `gemini`). |

### Regras

1. **Zero tráfego externo garantido pelo código.** Com `THINKER_SIMULATION=true`, a camada de saída (`common/outbound/`) recusa qualquer requisição a host que não seja loopback ou rede privada, com erro claro e log. Implica também `THINKER_CATALOG_SYNC=false` e a redescoberta periódica desligada. O kill switch por proxy das anotações locais deixa de ser necessário aqui.
2. As URLs de `THINKER_SIM_BASE_URLS` têm de ser loopback ou rede privada; outra derruba o boot com mensagem clara.
3. No OpenCode, o catálogo vem de `<origem>/inference/v1/models` e `<origem>/inference/go/v1/models` (o wwz serve os dois); a busca em `models.opencode.ai` é pulada.
4. Na OpenAI, chat, Responses e a listagem de modelos (`provider-model-fetcher`) usam a origem simulada.
5. O backend registra no boot um aviso em destaque (`SIMULATION MODE: providers are simulated, no external traffic`), `GET /api/v1/health` informa `simulation: true` e o dashboard mostra um selo "Simulation" na barra superior.
6. Nenhuma outra mudança de comportamento: os adapters, cabeçalhos (`User-Agent` do OpenCode, `x-opencode-session`) e regras de roteamento são os de produção. É isso que torna a simulação útil.

Antes de mexer nesses arquivos, leia os dossiês `docs/externos/api/api-opencode.md`, `docs/externos/assinatura/sub-opencode-go.md` e `docs/externos/api/api-openai.md`, e a [ADR 0009](../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md).

## Thinker de simulação

Uma instância nova, contendo **só o necessário**:

- PostgreSQL descartável `thk-sim-pg` com banco vazio (`thinker_sim`), sem `SEED_DATA`.
- Backend do repositório (`node dist/main`) com um `.env` gerado por `sim/up.sh` em `sim/.state/env`: segredos aleatórios locais, `THINKER_SIMULATION=true`, `THINKER_SIM_BASE_URLS`, `THINKER_RECORDING_STORAGE=filesystem` em `sim/.state/rec`, `MCP_ENABLED=false`.
- Dashboard pelo Vite (`VITE_BACKEND_PORT=18300`, porta 18301).
- `sim/.state/` fica fora do git (adicionar ao `.gitignore`).

### Carga inicial (`sim/seed.sh`)

Pela API pública do Thinker, sem SQL direto:

1. Admin pelo `/setup`: `admin@sim.local` com senha gerada, gravada em `sim/.state/admin.txt` (600).
2. Três harnesses, com as chaves `thk_` gravadas em `sim/.state/keys.env`:

| Harness | Tipo | Rota padrão | Fallback | Para observar |
| --- | --- | --- | --- | --- |
| `sim-opencode-free` | OpenCode | OpenCode `public`, `big-pickle` | — | modelos gratuitos, cota diária |
| `sim-opencode-go` | OpenCode | OpenCode Go `sim-opencode-go`, `deepseek-v4.1-flash` | OpenAI `gpt-5.5-mini` | cota Go esgotando e o fallback para a OpenAI |
| `sim-codex` | Codex | OpenAI `gpt-5.5` (Responses) | — | tarifação sem limite, raciocínio, tool calls |

3. As conexões de provedor de cada harness: OpenCode sem chave (gratuitos), OpenCode Go com `sim-opencode-go`, OpenAI por chave com `sim-openai-key`. Gravação ligada nos três.

## Agentes simulados (`sim/agents/`)

Cada agente é um laço infinito com pausas discretas, que roda uma sessão de cada vez com o `wwz-load agents`:

```text
enquanto não interrompido:
  sessão = sim-<agente>-<data>-<n>
  wwz-load agents --target http://127.0.0.1:18300 --protocol openai --stream \
    --key <thk_ do harness> --model <modelo> --agents 1 --sessions 1 \
    --turns <T> --max-tool-rounds 4 --think-time <pausa entre turnos> \
    --header "x-session-key: <sessão>" --header "user-agent: <UA do harness>" \
    --retries 0 --output json --out sim/.state/agents/<agente>/<sessão>.json
  dorme um tempo aleatório entre <pausa mínima> e <pausa máxima>
```

- `sim/agents/agents.conf`, uma linha por agente: nome, harness (chave em `keys.env`), modelo, perfil do `wwz-load` (`coder`, `pesquisa`, `chat`), turnos, pausa entre turnos e pausas mínima/máxima entre sessões. Padrão: um agente por harness da carga inicial (`sim-opencode-free` com `chat`, 2 turnos, 10–30 s; `sim-opencode-go` com `coder`, 3 turnos, 5–15 s; `sim-codex` com `pesquisa`, 3 turnos, 15–45 s).
- `sim/agents/run.sh` sobe um laço por linha em segundo plano, escreve o PID em `sim/.state/agents/pids` e uma linha de progresso por sessão em `sim/.state/agents/<agente>.log`; `sim/agents/stop.sh` encerra todos.
- As ferramentas pedidas pelo modelo são executadas pelo catálogo falso do `wwz-tools`, dentro do processo do `wwz-load`. O resultado volta na conversa, então o Thinker vê o ciclo completo: prompt, tool call, tool result, resposta.
- `--retries 0` deixa as falhas visíveis no Thinker (quem tenta de novo é o fallback do gateway, não o agente).
- `x-session-key` muda a cada sessão, então cada sessão aparece separada em Sessões e pode ser acompanhada pela janela ao vivo.
- O `User-Agent` imita o harness (`opencode/...` nos dois do OpenCode, `codex_cli_rs/...` no Codex), para a classificação do chamador do Thinker funcionar como com o cliente real.

## Orquestração

| Script | O que faz |
| --- | --- |
| `sim/up.sh` | Confere os binários do wwz, sobe os dois mocks (logs em `sim/.state/logs/`), o Postgres, compila e sobe o backend e o Vite, roda o `seed.sh` na primeira vez e inicia os agentes. Idempotente: o que já está de pé fica. |
| `sim/down.sh` | Para agentes, Vite, backend e mocks; mantém o Postgres e o `sim/.state/` (dados preservados). |
| `sim/reset.sh` | `down.sh` mais a remoção do contêiner `thk-sim-pg` e de `sim/.state/`. |
| `sim/status.sh` | Uma linha por peça (de pé ou não, porta), as últimas sessões de cada agente, o `spend_usd` de cada wwz (`/admin/entities`) e a cota restante do `sim-opencode-go` (`/inference/go/v1/usage`). |

Também entram em `.claude/launch.json` (local) as configurações `sim-backend`, `sim-web`, `sim-wwz-opencode` e `sim-wwz-openai`, para o app do Claude abrir o dashboard no navegador embutido.

## O que observar

| Comportamento | Como provocar | Onde ver no Thinker |
| --- | --- | --- |
| Streaming, raciocínio e ferramentas ao vivo | agentes rodando | Sessões → "Watch live" (abas Chat, Detalhes e Inspetor) |
| Modelos gratuitos do OpenCode | `sim-opencode-free` | Requisições com custo zero; conta OpenCode |
| Cota Go esgotando e fallback | `sim-opencode-go` (a cota de 5 h acaba em ~70 requisições de ~400 tokens) | Erro de cota na tentativa 1 e tentativa 2 na OpenAI (janela ao vivo e Requisições); medidor de uso do OpenCode Go; status da rota em Roteamento |
| Tarifação sem limite | `sim-codex` | Custo por requisição e totais no Thinker comparados com o `spend_usd` em `/admin/entities` do wwz da OpenAI |
| Falhas e caos | cabeçalhos ou perfis de erro do wwz (`errors:` no YAML, ou `/admin` do wwz) | Alertas, taxa de sucesso, eventos `route.out_of_service` |

## Critérios de aceite

1. `sim/up.sh` num checkout limpo deixa tudo de pé e, em até 2 minutos, Sessões mostra sessões dos três agentes.
2. Com o modo simulação ligado, nenhum pacote sai da máquina para fora de loopback e redes privadas (teste: o backend com rede externa bloqueada funciona igual, e uma requisição forçada a um host público é recusada pelo código com log).
3. A cota do `sim-opencode-go` esgota e o Thinker cai para a OpenAI sem erro para o agente.
4. O custo do `sim-codex` no Thinker bate com o `spend_usd` da chave no admin do wwz da OpenAI (mesmos preços).
5. Sem `THINKER_SIMULATION`, nenhum comportamento muda: as suítes atuais passam sem alteração, e um teste prova que `THINKER_SIM_BASE_URLS` é ignorada.
6. `sim/down.sh` seguido de `sim/up.sh` retoma com os dados preservados; `sim/reset.sh` volta ao zero.

## Fora do escopo

- Simular as assinaturas por OAuth (ChatGPT, Claude): o wwz tem o modo assinatura do Claude Code, que fica para depois.
- Rodar a simulação em Docker Compose: primeiro o modo local com scripts.
- Mudar os mocks do wwz: configurações novas, sim; código do White Wizard, não.
