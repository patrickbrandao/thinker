# CLI `thinker`

A CLI gerencia um gateway Thinker pelo terminal: cria harnesses (agentes), conecta provedores, configura o roteamento e consulta requisições. Ela só conversa com a instância que você indicar (por padrão `http://localhost:2099`) e nunca com um serviço hospedado.

O pacote é `thinker-cli` e instala o comando `thinker`. Requer Node.js 20 ou mais novo. Não é publicado em registro npm; instale a partir de um checkout do repositório:

```bash
npm ci
npm run build --workspace=packages/shared
npm run build --workspace=packages/cli
npm install -g ./packages/cli
thinker --help
```

Início rápido:

```bash
thinker login                      # abre o navegador (login com PKCE)
thinker agent create --name meu-app --platform openai-sdk
thinker provider connect openai --agent meu-app --credential-env OPENAI_API_KEY
thinker routing status meu-app
thinker agent setup meu-app        # instruções de conexão, com a chave mascarada
```

Para um gateway em outro host: `thinker login --url https://gateway.exemplo.com`. Para scripts: `printf '%s' "$CHAVE" | thinker login --token-stdin` ou `thinker login --token-env VARIAVEL`.

A CLI guarda o login em `~/.config/thinker/` e lê `THINKER_URL`, `THINKER_API_KEY`, `THINKER_AGENT_KEY` e `THINKER_AGENT_URL`. Referência completa de comandos e credenciais: [`packages/cli/README.md`](../../packages/cli/README.md).

## Modelos virtuais

Os [modelos virtuais](provedores-e-roteamento.md#modelos-virtuais) são nomes que o harness manda em `model`, cada um com a sua cadeia. Os comandos usam o nome do harness (`<agente>`) e acham o virtual pelo nome, sem diferenciar maiúsculas, ou pelo `id`.

```bash
thinker routing virtual list meu-app
thinker routing virtual create meu-app --name deepseek/flash \
  --model deepseek-chat --fallback deepseek-reasoner --continue-on-default
thinker routing virtual update meu-app deepseek/flash --fallback gpt-5.5-mini --no-continue-on-default
thinker routing virtual disable meu-app deepseek/flash
thinker routing virtual enable meu-app deepseek/flash
thinker routing virtual delete meu-app deepseek/flash --yes
```

| Comando | Flags |
| --- | --- |
| `routing virtual list <agente>` | Lista os virtuais com cadeia, `shadows` (IDs reais sombreados), `context_length` e `routable`. |
| `routing virtual create <agente>` | `--name <nome>` (obrigatória); `--model <m>` (principal), com `--provider`, `--auth-type` e `--key-label` para fixar a rota; `--fallback <m>` (repetível, até 5, exige `--model`); `--continue-on-default`; `--response-mode buffered\|stream`. |
| `routing virtual update <agente> <nome>` | Muda só o que você passa: `--name <novo>`, `--model <m>` (troca o principal e mantém os fallbacks), `--fallback <m>` (repetível, troca a lista) ou `--clear-fallbacks`, `--clear-model` (remove o principal e os fallbacks), `--continue-on-default` ou `--no-continue-on-default`, `--response-mode`. |
| `routing virtual enable\|disable <agente> <nome>` | Ativa ou desativa. Desativado, o virtual some de `/v1/models` e deixa de sombrear. |
| `routing virtual delete <agente> <nome> --yes` | Apaga o virtual e os parâmetros por modelo dele. A flag `--yes` é obrigatória. |

As rotas são validadas no servidor: um modelo que o harness não consegue rotear responde 400, e não há `--force`. Um nome repetido responde 409. No `update`, as escritas são requisições separadas; se uma falha depois de outra aplicada, a mensagem lista o que já foi gravado.

### Status

`thinker routing status <agente>` inclui `virtual_models` (cadeia, `continue_on_default`, `response_mode` e `shadows` de cada um) e dois campos novos:

- `active_virtual_models`: os nomes dos virtuais ativos que têm rota segundo o catálogo do agente (calculado a partir do catálogo; o proxy ainda confere cada rota a cada pedido);
- `routes_by_virtual_model`: `true` quando há pelo menos um.

O `default` do status diz só o que `model: "auto"` roteia. Um harness com o `default` vazio ainda roteia os pedidos que citam um virtual com rota; olhe `routes_by_virtual_model`.

### Testar

```bash
thinker routing test meu-app --model deepseek/flash
```

Envia um pedido real pela superfície do harness, com o virtual em `model`. A saída acrescenta `routing_reason` (`virtual-model`) e `virtual_model` (o nome cadastrado), lidos dos [cabeçalhos `X-Thinker-*`](provedores-e-roteamento.md#cabeçalhos-de-resposta-x-thinker). O teste grava linhas reais no log de requisições.

### Parâmetros por modelo

```bash
thinker routing params get meu-app --virtual deepseek/flash [--model deepseek-chat]
thinker routing params set meu-app --virtual deepseek/flash --model deepseek-chat \
  --set reasoning.effort=high --unset temperature
```

`--virtual <nome>` e `--tier <nome>` são exclusivos, porque um tier customizado e um virtual podem ter o mesmo nome. `--model` aceita o ID que `GET /v1/models` publica (por exemplo `<alias>/<modelo>` de um provedor customizado), o ID guardado na rota ou o ID nativo sem prefixo, este último quando só uma conexão da cadeia o tem. O casamento é em camadas e a primeira com resultado vence: o ID guardado, depois o ID público, depois o nativo. Só há ambiguidade dentro da camada que casou. A saída lista `models` e `public_models`. Só a cadeia do próprio virtual é editável aqui: as rotas que entram por Continue on Default usam os parâmetros do tier `default`.
