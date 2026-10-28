# Thinker

<p>
  <a href="https://hub.docker.com/r/tmsoftbrasil/thinker"><img src="https://img.shields.io/docker/pulls/tmsoftbrasil/thinker?color=2496ED&label=docker%20pulls" alt="Docker pulls" /></a>
  &nbsp;
  <a href="https://github.com/patrickbrandao/thinker/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Licença MIT" /></a>
</p>

Gateway de LLM open source e auto-hospedado. O Thinker fica entre os seus agentes (Claude Code, Codex, OpenCode, OpenClaw, Hermes, aplicações com SDK) e os provedores de inferência (chaves de API, assinaturas, modelos locais, endpoints customizados), roteia cada requisição para o modelo certo e registra custo, tokens e o corpo completo das chamadas.

O projeto nasceu de um snapshot de [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) (licença MIT) e evolui de forma independente. A imagem inclui `/app/LICENSE` e `/app/THIRD_PARTY_NOTICES`.

Imagem multi-arquitetura (`linux/amd64` e `linux/arm64`), executada como usuário não-root. Porta padrão: `2099`.

## Instalação rápida

```bash
bash <(curl -sSL https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/install.sh)
```

O instalador baixa o compose, gera os segredos e sobe a stack em `~/thinker`. Flags: `--dir`, `--port`, `--dry-run`, `--yes`, `--upgrade`.

Manualmente, com Compose:

```bash
curl -O https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/.env.example
cp .env.example .env     # defina BETTER_AUTH_SECRET e THINKER_ENCRYPTION_KEY (openssl rand -hex 32, dois valores diferentes)
docker compose up -d
```

### Primeiro acesso

O cadastro público é fechado. O primeiro administrador precisa do **token de setup** de uso único, impresso no log:

```bash
docker compose logs thinker | grep 'setup token'
```

Abra [http://localhost:2099/setup](http://localhost:2099/setup), informe o token e crie o administrador. Com várias réplicas, cada processo tem o seu token: faça o primeiro setup na réplica cujo log o imprimiu. Para não depender do log, defina o token antes de subir com `THINKER_SETUP_TOKEN` (16+ caracteres). `THINKER_ALLOW_SIGNUP=true` reabre o cadastro depois que o administrador existe.

### Teste

```bash
curl -X POST http://localhost:2099/v1/chat/completions \
  -H "Authorization: Bearer thk_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Olá"}]}'
```

Conecte um provedor e crie um harness no dashboard para obter a chave `thk_`. O tier `default` do harness precisa de um modelo para o `auto` funcionar.

## Docker Run (com seu PostgreSQL)

```bash
docker run -d \
  -p 2099:2099 \
  -e DATABASE_URL=postgresql://usuario:senha@host:5432/thinker \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e THINKER_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -e BETTER_AUTH_URL=http://localhost:2099 \
  tmsoftbrasil/thinker
```

`THINKER_ENCRYPTION_KEY` é obrigatória, tem 32 caracteres ou mais e precisa ser diferente de `BETTER_AUTH_SECRET`; não há fallback. Guarde-a: sem ela as credenciais armazenadas não podem ser lidas. As migrações rodam a cada boot.

## Tags

- `X.Y.Z`: versão fixa (por exemplo `0.1.0`).
- `X.Y`: último patch da minor (só versões estáveis).
- `latest`: última versão estável.
- `sha-<curto>`: commit exato, para rollback.
- `X.Y.Z-rc.N`: candidatas a release; nunca movem `X.Y` nem `latest`.

## Atualização

```bash
docker compose pull
docker compose up -d
```

Fixe `THINKER_VERSION=0.1` no `.env` para controlar quando atualizar. Leia as [notas de release](https://github.com/patrickbrandao/thinker/tree/main/docs/releases) antes de subir de versão.

### Trocar a chave de cifragem (rotação)

Vale para uma rotação e para quem atualiza uma instalação que dependia do antigo fallback para `BETTER_AUTH_SECRET`:

1. Defina a chave nova em `THINKER_ENCRYPTION_KEY`.
2. Defina `THINKER_ENCRYPTION_KEY_PREVIOUS` com a chave antiga (no caso do fallback antigo, o valor de `BETTER_AUTH_SECRET`).
3. Suba e espere no log a mensagem `Secret re-encryption complete` e a linha `Nothing left under an older secret`.
4. Remova `THINKER_ENCRYPTION_KEY_PREVIOUS`.

Chaves de provedores e tokens OAuth são regravados; as gravações de requisições não, e ficam ilegíveis até a retenção apagá-las.

## Backup

Os dados ficam nos volumes `thinker_pgdata` (PostgreSQL) e `thinker_request_recordings` (gravações locais, fora do dump). Guarde também o `.env`.

```bash
docker compose exec -T postgres pg_dump -U thinker thinker > thinker-backup-$(date +%F).sql
```

`docker compose down -v` apaga tudo.

O PostgreSQL é o 18: o volume `thinker_pgdata` é montado em `/var/lib/postgresql` e os dados ficam em `/var/lib/postgresql/18/docker`. Não há migração de um volume PostgreSQL 16 (não existem instalações anteriores); com um volume antigo o PostgreSQL 18 recusa subir. Nesse caso, faça dump, `down -v`, suba de novo e restaure.

## Acesso pela rede e proxy reverso

O compose publica a porta só em `127.0.0.1`. Para a LAN, ponha `HOST_BIND_ADDRESS=0.0.0.0` e `BETTER_AUTH_URL` com a URL exata do navegador no `.env`. Atrás de proxy reverso, defina `TRUSTED_PROXIES` com o IP do proxy e uma `BETTER_AUTH_URL` HTTPS. `BETTER_AUTH_URL` precisa ser alcançável de dentro do container (o MCP busca o JWKS nela). Detalhes: [instalação com Docker](https://github.com/patrickbrandao/thinker/blob/main/docs/usuario/instalacao-docker.md).

## Modelos locais

O container alcança servidores do host por `host.docker.internal:<porta>`: Ollama (`OLLAMA_HOST`, padrão porta 11434), LM Studio (`THINKER_LMSTUDIO_BASE_URL`, 1234) e llama.cpp (`THINKER_LLAMACPP_BASE_URL`, 8080). Ligue o servidor em `0.0.0.0`.

## Variáveis de ambiente

As principais:

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sim | -- | Conexão PostgreSQL (o compose já define). |
| `BETTER_AUTH_SECRET` | Sim | -- | Assinatura de sessões, 32+ caracteres. |
| `THINKER_ENCRYPTION_KEY` | Sim | -- | Cifra credenciais e gravações, 32+ caracteres, diferente de `BETTER_AUTH_SECRET`. |
| `THINKER_ENCRYPTION_KEY_PREVIOUS` | Não | -- | Chave antiga, só durante a rotação. |
| `THINKER_SETUP_TOKEN` | Não | aleatório no log | Token do primeiro setup definido pelo operador (16+ caracteres). Não aparece no log. |
| `THINKER_ALLOW_SIGNUP` | Não | `false` | `true` reabre o cadastro depois do primeiro administrador. |
| `BETTER_AUTH_URL` | Não | `http://localhost:${PORT}` | URL pública, igual à do navegador. |
| `PORT` | Não | `2099` | Porta do servidor e do compose. |
| `THINKER_RECORDING_RETENTION_DAYS` | Não | `30` | Retenção das gravações, em dias. |
| `THINKER_CATALOG_SYNC` | Não | `true` | `false` desliga a busca dos catálogos públicos. |

A referência completa está em [configuração](https://github.com/patrickbrandao/thinker/blob/main/docs/usuario/configuracao.md) e no [`.env.example`](https://github.com/patrickbrandao/thinker/blob/main/docker/.env.example). `NODE_ENV` e `SEED_DATA` são fixos pelo compose.

## Sem telemetria

O container não faz nenhuma chamada de saída por conta própria: sem telemetria de uso, sem verificação de atualização, sem relatório de erros. Ele só contata os provedores que você configurou e os destinos abaixo:

| Destino | Quando |
| --- | --- |
| `openrouter.ai` (`/api/v1/models`) | No boot e uma vez por dia |
| `models.dev` (`/api.json`) | No boot e uma vez por dia |
| `raw.githubusercontent.com` (documento do OpenCode Go) | Só com um provedor OpenCode Go cadastrado; cache de 1 hora |
| URL de metadados do cliente MCP (CIMD) | Quando um cliente MCP faz login por OAuth: o servidor busca o documento na URL HTTPS que o cliente informa como `client_id`. Só endereços públicos, salvo `THINKER_CIMD_ALLOW_PRIVATE=true`. Desligue o MCP com `MCP_ENABLED=false`. |

`THINKER_CATALOG_SYNC=false` desliga os três primeiros, por exemplo num host isolado da internet; os preços passam a vir só dos dados embutidos, e a maioria dos modelos aparece com `$0`. Lista completa em [privacidade](https://github.com/patrickbrandao/thinker/blob/main/docs/usuario/privacidade.md).

## Links

- [GitHub](https://github.com/patrickbrandao/thinker)
- [Documentação (PT-BR)](https://github.com/patrickbrandao/thinker/tree/main/docs)
- [Issues](https://github.com/patrickbrandao/thinker/issues)

## Licença

[MIT](https://github.com/patrickbrandao/thinker/blob/main/LICENSE)
