# Instalação com Docker

A instalação oficial do Thinker é Docker/Compose: a imagem `tmsoftbrasil/thinker` (`linux/amd64` e `linux/arm64`) e um PostgreSQL 16. Não há instalação via npm.

## Requisitos

- Docker Engine 20.10 ou mais novo (Docker Desktop serve) com o plugin `docker compose`.
- `bash`, `curl` e `openssl` para o instalador.
- A porta `2099` livre no host (ou outra, veja [Porta](#porta-e-acesso-pela-rede)).

## Opção 1: instalador (recomendado)

```bash
bash <(curl -sSL https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/install.sh)
```

O script baixa o `docker-compose.yml` e o `.env.example`, gera `BETTER_AUTH_SECRET` e `THINKER_ENCRYPTION_KEY` (dois valores diferentes) num `.env`, e sobe a stack. A primeira subida baixa a imagem e o PostgreSQL; dê alguns minutos.

Para revisar o script antes de rodar:

```bash
curl -sSLO https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/install.sh
less install.sh
bash install.sh
```

Flags úteis: `--dir <caminho>` (padrão `$HOME/thinker`), `--port <n>`, `--dry-run`, `--yes` (sem confirmação) e `--upgrade` (veja [Atualização](#atualização)). Rodar o instalador de novo num diretório já instalado retoma a instalação sem tocar no compose nem nos segredos.

## Opção 2: Compose manual

```bash
mkdir thinker && cd thinker
curl -O https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/.env.example
cp .env.example .env
```

Edite o `.env` e defina duas variáveis obrigatórias, com valores **diferentes**:

```bash
openssl rand -hex 32   # BETTER_AUTH_SECRET
openssl rand -hex 32   # THINKER_ENCRYPTION_KEY
```

- `BETTER_AUTH_SECRET` assina as sessões (mínimo de 32 caracteres).
- `THINKER_ENCRYPTION_KEY` cifra em repouso as chaves de provedores, os tokens OAuth e as gravações de requisições. É obrigatória, tem no mínimo 32 caracteres, deve ser diferente de `BETTER_AUTH_SECRET` e **não há fallback**: sem ela o servidor se recusa a iniciar.

Suba a stack:

```bash
docker compose up -d
docker compose logs -f thinker
```

As migrações rodam sozinhas a cada boot.

## Primeiro acesso: o token de setup

O cadastro público é fechado. Enquanto não existe nenhum usuário, o Thinker gera um **token de setup de uso único** e o imprime no log do servidor. Para achá-lo:

```bash
docker compose logs thinker | grep 'setup token'
```

A linha tem o formato `No admin account exists yet. Open /setup and enter this one-time setup token: <token>`. Abra [http://localhost:2099/setup](http://localhost:2099/setup), informe o token e crie a conta de administrador. O token deixa de valer assim que o primeiro administrador existe.

Para escolher o token em vez de procurá-lo no log, defina `THINKER_SETUP_TOKEN` no `.env` antes de subir (mínimo de 16 caracteres; gere com `openssl rand -hex 24`). O log então só avisa que o token vem dessa variável, sem imprimi-lo, e ele vale em todas as réplicas.

Sem `THINKER_SETUP_TOKEN`, se o container reiniciar antes do setup, um token novo é impresso (o token fica só na memória do processo). Depois do primeiro administrador, o cadastro continua fechado. Enquanto a criação de contas pelo administrador não existe (prevista para a v0.3), a válvula provisória `THINKER_ALLOW_SIGNUP=true` reabre o cadastro por e-mail e login social; desligue-a depois de criar as contas (veja [Configuração](configuracao.md)).

> **Várias réplicas:** cada processo guarda o seu próprio token. Num deploy com mais de uma réplica, faça o primeiro setup na réplica cujo log imprimiu o token, ou rode com uma única réplica até o administrador existir. Em deploys assim, desligue as migrações nas demais com `RUN_MIGRATIONS_ON_BOOT=false` e use armazenamento S3 para as gravações.

Depois do setup, siga [Primeiros passos](primeiros-passos.md).

## Porta e acesso pela rede

Por padrão o compose publica a porta só em `127.0.0.1`. Para mudar:

```env
# .env
PORT=8080                  # muda a porta publicada e a interna (o instalador faz isso com --port)
HOST_BIND_ADDRESS=0.0.0.0  # expõe na LAN
BETTER_AUTH_URL=http://192.168.1.20:8080
```

`BETTER_AUTH_URL` precisa ser exatamente a URL que você digita no navegador (host e porta); se não for, o login falha com "Invalid origin". Se a mesma instância responde em mais de um domínio, liste os extras em `BETTER_AUTH_ALLOWED_HOSTS`.

**`BETTER_AUTH_URL` deve ser alcançável de dentro do container.** A verificação de token do servidor MCP busca o JWKS nessa URL. Se ela não resolve de dentro do container (porta do host diferente da interna sem `PORT` correspondente, ou URL pública que o container não alcança), as chamadas MCP respondem `401 no token payload`. Atrás de um proxy reverso, garanta a resolução do nome ou o hairpin NAT.

## Proxy reverso com HTTPS

1. Aponte o proxy para `127.0.0.1:2099` (ou a porta escolhida).
2. No `.env`, ponha a URL pública em `BETTER_AUTH_URL` (por exemplo `https://thinker.exemplo.com`).
3. Defina `TRUST_PROXY` com o endereço ou CIDR do proxy (por exemplo `TRUST_PROXY=172.18.0.0/16`, ou o número de saltos, `TRUST_PROXY=1`). O padrão do compose é `loopback`, para que clientes não falsifiquem `X-Forwarded-For` e escapem do limite por IP.
4. Para streaming (SSE), desligue o buffering de resposta no proxy.

Sem HTTPS o servidor avisa no boot que não pode enviar HSTS. Numa LAN só com HTTP, `THINKER_DISABLE_HSTS=1` silencia o aviso. O servidor MCP exige `BETTER_AUTH_URL` em HTTPS (ou localhost); com uma URL HTTP de LAN ele se desliga sozinho.

## Atualização

Não há aviso de nova versão (o produto não consulta a internet por conta própria). Acompanhe as [notas de release](../releases/).

```bash
cd ~/thinker
docker compose pull
docker compose up -d
```

Ou, para também substituir o compose gerenciado com backup: `bash install.sh --upgrade` (com `--dir` se não for `~/thinker`). Para controlar quando atualizar, fixe `THINKER_VERSION=0.1` no `.env`. Tags publicadas: `X.Y.Z`, `X.Y`, `latest` e `sha-<curto>`; versões `-rc.N` nunca movem `X.Y` nem `latest`.

Veja as notas de cada versão para mudanças que pedem ação, em especial [0.1.0](../releases/0.1.0.md).

## Rotação da chave de cifragem

Para trocar `THINKER_ENCRYPTION_KEY`, o mesmo procedimento vale para uma rotação comum e para instalações antigas que dependiam do fallback para `BETTER_AUTH_SECRET`:

1. Gere a chave nova (`openssl rand -hex 32`) e ponha em `THINKER_ENCRYPTION_KEY`.
2. Ponha a chave antiga em `THINKER_ENCRYPTION_KEY_PREVIOUS`. Se a instalação usava o fallback, a chave antiga é o valor de `BETTER_AUTH_SECRET`.
3. Reinicie (`docker compose up -d`) e espere o log `Secret re-encryption complete` e a linha `Nothing left under an older secret — THINKER_ENCRYPTION_KEY_PREVIOUS can be removed.` (`docker compose logs thinker | grep -i 're-encryption\|Nothing left'`).
4. Remova `THINKER_ENCRYPTION_KEY_PREVIOUS` do `.env` e reinicie.

Chaves de provedores e tokens OAuth são regravados com a chave nova. **As gravações de requisições não são regravadas:** o que foi gravado sob a chave antiga fica ilegível (o dashboard mostra como indisponível) até a retenção apagá-lo.

## Backup

O estado fica em dois volumes: `thinker_pgdata` (PostgreSQL) e `thinker_request_recordings` (gravações locais, que **não** entram no dump do PostgreSQL). Guarde também o `.env`: sem a `THINKER_ENCRYPTION_KEY` as credenciais armazenadas não podem ser lidas.

```bash
cd ~/thinker
docker compose exec -T postgres pg_dump -U thinker thinker > thinker-backup-$(date +%F).sql
```

Restauração numa stack nova:

```bash
docker compose up -d postgres
cat thinker-backup-AAAA-MM-DD.sql | docker compose exec -T postgres psql -U thinker thinker
docker compose up -d
```

`docker compose down` mantém os dados; `docker compose down -v` **apaga tudo**.

## Quem vem do Manifest

O 0.1 só suporta instalação nova. O projeto Compose, o usuário e o banco do PostgreSQL agora se chamam `thinker`, então os volumes são novos e os dados antigos não aparecem. Detalhes em [Notas de release 0.1.0](../releases/0.1.0.md).

## Modelos locais

O container alcança servidores no host por `host.docker.internal:<porta>`. Veja [Provedores e roteamento](provedores-e-roteamento.md#modelos-locais).
