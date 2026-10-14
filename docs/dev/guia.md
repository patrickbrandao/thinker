# Guia do desenvolvedor do Thinker

Guia técnico do repositório: arquitetura, comandos, autenticação, roteamento, gravações, migrações, testes, CI, releases e o fluxo de trabalho com agentes. Para o uso do produto, veja [`docs/usuario/`](../usuario/instalacao-docker.md). A terminologia de domínio está em [`terminologia.md`](terminologia.md). As decisões do projeto estão em [`decisoes-iniciais.md`](../decisoes-iniciais.md) e em [`docs/adr/`](../adr/).

O Thinker começou como um snapshot sem histórico de [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) (`manifest@6.28.6`) e evolui de forma independente; não há obrigação de compatibilidade com o Manifest. Convenções de nome: variáveis `THINKER_*`, prefixo de chave `thk_`, CLI `thinker`, imagem `tmsoftbrasil/thinker`, porta `2099`. Nunca crie identificadores novos com `manifest`/`mnfst`.

> Língua: código, identificadores, comentários, commits e PRs em inglês; documentação em `docs/` e notas de release em português. O texto da interface fica em inglês na v0.1.

## O que é

O Thinker é um gateway de LLM auto-hospedado. Ele fica entre agentes ("harnesses") e provedores de inferência, escolhe o modelo de cada requisição e registra custo, tokens e corpo das chamadas. No dashboard, "Harness" é o nome de um agente (rotas `/harnesses`); no backend, no banco e na API continua `agent`.

Três superfícies de gestão compartilham a mesma API REST (`/api/v1/*`): o dashboard, a CLI `thinker` (`packages/cli/`) e o servidor MCP remoto (`packages/backend/src/mcp/`). Adicione a capacidade uma vez na camada de serviço e exponha onde precisar; nunca duplique a lógica por superfície.

## Arquitetura

Monorepo com npm workspaces e Turborepo:

```text
packages/
├── shared/     thinker-shared    tipos e helpers usados por backend, frontend e CLI (provedores, tiers, snippets)
├── backend/    thinker-backend   NestJS 11, TypeORM 0.3, PostgreSQL 16, Better Auth
├── frontend/   thinker-frontend  SolidJS + Vite, dashboard
├── cli/        thinker-cli       CLI `thinker` (privada, não publicada)
└── thinker/    thinker           pacote sem código que guarda a versão canônica
integrations/n8n-nodes-thinker/   nó da comunidade para n8n (fora dos workspaces)
contracts/gateway/                testes de contrato HTTP do gateway
design-system/                    registro do design system (gerado)
deploy/                           templates de deploy da comunidade
docker/                           Dockerfile, docker-compose.yml, install.sh, .env.example
```

Em produção o NestJS serve a API e os arquivos estáticos do frontend na **mesma porta** (um serviço só). Em desenvolvimento, o Vite roda na `:3000` e faz proxy de `/api` para o backend na `:3001`.

Módulos do backend (`packages/backend/src/`):

| Pasta | Função |
| --- | --- |
| `auth/` | Better Auth, guards de sessão, política de cadastro, login da CLI (PKCE), `GET /api/v1/me` |
| `setup/` | Assistente do primeiro administrador e token de setup |
| `database/` | Configuração do TypeORM, migrações, sincronização de preços, retenção, re-cifragem |
| `entities/` | Entidades TypeORM |
| `common/` | Guards, DTOs, filtros, erros (`M###`), cifragem, validação de URL/SSRF, serviços de gravação |
| `routing/` | Provedores, tiers, resolução, proxy (`/v1/*`), fallback, OAuth de assinaturas, provedores customizados, tiers por cabeçalho |
| `scoring/` | Pontuação de complexidade das requisições |
| `model-discovery/`, `model-prices/` | Descoberta de modelos por provedor e preços |
| `analytics/` | Análises do dashboard (visão geral, tokens, custos, requisições) |
| `notifications/` | Regras de alerta e provedores de e-mail |
| `playground/`, `sse/`, `health/` | Playground, eventos em tempo real, health check |
| `mcp/` | Servidor MCP remoto (OAuth 2.1, uma instância por POST, ferramentas em `tools/`) |
| `otlp/` | Autenticação por chave de agente (`thk_`); o ingest OTLP responde 410 |

Fonte única dos provedores: `SHARED_PROVIDERS` em `packages/shared/src/` (reexportado como `PROVIDER_REGISTRY` em `common/constants/providers.ts`). Não repita nomes de provedores em outro lugar. Para adicionar um provedor: entrada em `SHARED_PROVIDERS`; `FetcherConfig` em `model-discovery/provider-model-fetcher.service.ts`; `ProviderEndpoint` em `routing/proxy/provider-endpoints.ts`; `ProviderDef` em `packages/frontend/src/services/providers.ts`.

## Comandos

Pré-requisito: Node.js (a CI usa a 24) e Docker para os testes e2e.

```bash
npm ci
npm run build --workspace=packages/shared     # o shared precisa estar compilado antes dos outros
npm run build                                  # turbo: frontend (Vite) e backend (Nest)
npm start                                      # node packages/backend/dist/main.js (API + frontend)
npm run lint
npm run typecheck --workspaces --if-present
npm test                                       # turbo test, todos os pacotes
npm run test:scripts                           # testes dos scripts do repositório
npm run check:changesets
```

### Servidor de desenvolvimento

O backend precisa de um `packages/backend/.env` com, no mínimo, `BETTER_AUTH_SECRET` e `THINKER_ENCRYPTION_KEY` (32+ caracteres, valores diferentes) e `DATABASE_URL`. O `auth.instance.ts` lê `process.env` na importação, antes do `ConfigModule`, por isso o `dotenv` é pré-carregado:

```bash
# backend
cd packages/backend && NODE_OPTIONS='-r dotenv/config' npx nest start --watch
# frontend (em outro terminal)
cd packages/frontend && npx vite
```

`npm run dev` (turbo) sobe só o frontend. `.env` mínimo:

```env
PORT=3001
BIND_ADDRESS=127.0.0.1
NODE_ENV=development
BETTER_AUTH_SECRET=<openssl rand -hex 32>
THINKER_ENCRYPTION_KEY=<outro openssl rand -hex 32>
DATABASE_URL=postgresql://usuario:senha@localhost:PORTA/thinker_dev_<aleatorio>
SEED_DATA=true
```

**Use um banco novo por sessão** e dê a ele um nome único (`thinker_<contexto>_<aleatório>`), para instâncias concorrentes não poluírem os dados umas das outras. Suba um PostgreSQL descartável pelo Docker numa **porta livre** (não use as portas 5432/5433 nem contêineres de outros projetos). `SEED_DATA=true` (só em dev/teste; ignorado com `NODE_ENV=production`) cria o admin `admin@thinker.example.com` / `thinker`, o harness `demo-agent` e dados de exemplo.

### Testes

| Escopo | Comando |
| --- | --- |
| Backend (Jest) | `npm test --workspace=packages/backend` |
| Frontend (Vitest) | `npm test --workspace=packages/frontend` |
| Shared | `npm test --workspace=packages/shared` |
| CLI | `npm test --workspace=packages/cli` |
| Backend e2e (Docker) | `npm run test:e2e:docker --workspace=packages/backend` |
| Contratos do gateway | `THINKER_BASE_URL=http://127.0.0.1:2099 node --test contracts/gateway/tests/*.test.mjs` |

**E2E só por `test:e2e:docker`.** A suíte usa `dropSchema: true` (apaga o banco). O script `packages/backend/scripts/test-e2e-docker.mjs` escolhe uma porta livre em `127.0.0.1`, sobe um `postgres:16-alpine` com nome único e dados em tmpfs (banco `thinker_e2e_test`), roda as migrações, executa a suíte em série e remove o contêiner no fim (sucesso, falha ou Ctrl-C). Argumentos extras vão para o Jest:

```bash
npm run test:e2e:docker --workspace=packages/backend -- test/limits.e2e-spec.ts
TZ=America/Sao_Paulo npm run test:e2e:docker --workspace=packages/backend
```

Uma proteção (`packages/backend/test/e2e-db-guard.ts`) recusa rodar sem `DATABASE_URL`, sem `THINKER_E2E_ALLOW_DROP=1` ou se o nome do banco não tiver `test` como token separado. Um teste de varredura (`e2e-db-guard-scan.spec.ts`) falha se um spec novo apagar o banco sem passar pela proteção, usar `DATABASE_URL ?? ...` ou citar `localhost:5432`. Os testes e2e nunca falam com a internet. Para um PostgreSQL seu: `DATABASE_URL=postgresql://.../thinker_e2e_test THINKER_E2E_ALLOW_DROP=1 npm run test:e2e --workspace=packages/backend`, nunca contra um banco de desenvolvimento.

Qualquer mudança de comportamento em tempo de execução também passa pelo agente `qa-docker`, contra a imagem construída localmente.

## Migrações

O esquema é gerenciado só por migrações TypeORM em `packages/backend/src/database/migrations/` (`synchronize` é sempre `false`). Elas rodam no boot, controladas por `RUN_MIGRATIONS_ON_BOOT` (padrão `true`; `false` nas réplicas que não devem migrar).

```bash
cd packages/backend
npm run migration:generate -- src/database/migrations/NomeDescritivo
npm run migration:run
npm run migration:revert
npm run migration:show
npm run migration:create -- src/database/migrations/Nome
```

Regras:

- Migração antiga é **imutável**. Para remover algo, crie uma migração nova (como `DropBillingSchema`, `DropAutofixSchema`).
- Use um timestamp único; nunca reaproveite o de outra migração.
- Importe a nova migração em `database.module.ts` e inclua-a no array `migrations`.
- O modo de transação é `each` (uma transação por migração), porque algumas migrações de índice usam `CONCURRENTLY`.
- Migrações costumam ter um spec ao lado; mudanças de dados ganham também um e2e.
- As tabelas do Better Auth têm migrações próprias, geridas por ele: `DatabaseSeederService` chama `ctx.runMigrations()` no boot. A checagem de schema do Better Auth na inicialização (`advanced.database.validateSchema`) fica desligada, porque roda antes dessa migração e registrava um falso "Database schema mismatch" em todo banco novo. `auth/better-auth-schema.ts` faz a mesma checagem logo depois da migração e só registra ERROR quando há divergência real.

## Autenticação

Três guards globais, nesta ordem:

1. **SessionGuard** (`auth/session.guard.ts`): respeita `@Public()`; valida o cookie de sessão do Better Auth.
2. **ApiKeyGuard** (`common/guards/api-key.guard.ts`): sem sessão, lê `X-API-Key` e procura na tabela `api_keys` (hash scrypt, escopo de tenant). Só se não achar compara, em tempo constante, com a variável `API_KEY`. Os tokens da CLI (`thinker login`) são linhas de `api_keys` chamadas `cli`, com TTL deslizante (`CLI_TOKEN_TTL_DAYS`, 30) e teto absoluto (`CLI_TOKEN_ABSOLUTE_TTL_DAYS`, 90).
3. **ThrottlerGuard**: limite de requisições (`THROTTLE_*`); o proxy `/v1/*` e o SSE ficam fora (`@SkipThrottle()`), pois têm limites próprios (`THINKER_RATE_MAX_REQUESTS`, `THINKER_IP_RATE_MAX_REQUESTS`, `THINKER_CONCURRENCY_MAX`).

As rotas `/v1/*` usam a chave do harness (`AgentKeyAuthGuard`, em `otlp/guards/`), em `Authorization: Bearer thk_...` ou `x-api-key`. Chaves diferentes nos dois cabeçalhos dão `M006`. A verificação consulta o banco a cada requisição para que rotação e exclusão valham em todas as réplicas; o contexto verificado fica em cache de 5 minutos.

**Better Auth** (`auth/auth.instance.ts`): e-mail/senha, Google, GitHub e Discord (cada um liga quando `CLIENT_ID` e `CLIENT_SECRET` estão definidos) e os plugins `jwt()` e `mcp()` (servidor de autorização OAuth 2.1 do MCP). É montado como middleware Express em `/api/auth/*splat`, **antes** de `express.json()`. `auth.instance.ts` é só ESM e não carrega no Jest; por isso constantes como `auth/mcp-scopes.ts` e `auth/mcp-availability.ts` ficam em módulos folha.

**Cadastro fechado** (#29): ninguém cria conta pela API pública. `auth/signup-policy.ts` decide e `auth.instance.ts` impõe em `databaseHooks.user.create.before` (cobre e-mail, social e plugins), com um `hooks.before` em `/sign-up/email`. A recusa é `403 { code: 'SIGNUP_DISABLED' }`; provedores sociais têm `disableSignUp`. O primeiro usuário só nasce no assistente (`setup/setup.service.ts`, trava advisory `9001`), dentro de `runAsServerUserCreation`, uma marca em `AsyncLocalStorage` que nenhuma requisição HTTP consegue definir. `THINKER_ALLOW_SIGNUP=true` é uma válvula provisória (removida na v0.3) que reabre o cadastro depois que o primeiro administrador existe; `GET /api/v1/setup/status` a expõe como `signupEnabled`.

**Token de setup** (#29): sem nenhum usuário no boot, `setup/setup-token.service.ts` gera um token aleatório, guarda só o SHA-256 na memória e imprime o token no log (`No admin account exists yet. Open /setup and enter this one-time setup token: ...`). `POST /api/v1/setup/admin` exige o token em `setupToken` (403 sem ele ou com valor errado; um token novo é impresso se nenhum está pendente). Ele é consumido ao criar o primeiro administrador. Cada processo tem o seu token, então com várias réplicas o primeiro setup precisa ir à réplica que o imprimiu.

**Cifragem em repouso**: `THINKER_ENCRYPTION_KEY` (obrigatória, 32+ caracteres, diferente de `BETTER_AUTH_SECRET`, sem fallback; `assertEncryptionKeyConfig` barra o boot) cifra com AES-256-GCM as chaves de provedores, os tokens OAuth e as gravações (`common/utils/crypto.util.ts`). `THINKER_ENCRYPTION_KEY_PREVIOUS` serve para rotação: no boot, `database/secret-reencryption.service.ts` regrava com a chave nova o que estava sob a antiga (com trava advisory) e registra `Secret re-encryption complete` e, quando nada sobrou, `Nothing left under an older secret`. A mesma receita migra instalações que usavam o antigo fallback para `BETTER_AUTH_SECRET`: chave nova em `THINKER_ENCRYPTION_KEY`, o valor antigo de `BETTER_AUTH_SECRET` em `THINKER_ENCRYPTION_KEY_PREVIOUS`, subir, esperar o log e remover a variável. As gravações **não** são regravadas.

Nomes herdados: `common/utils/legacy-env.ts` registra no boot um aviso com o nome (nunca o valor) de cada variável `MANIFEST_*` ainda definida e recusa iniciar se `MANIFEST_ENCRYPTION_KEY` estiver definida sem `THINKER_ENCRYPTION_KEY`.

## Multi-tenancy

```text
Usuário (Better Auth) ──→ Tenant ──→ Agent ──→ AgentApiKey (thk_*)
                                       └──→ requests ──→ agent_messages
```

- **Tenant** (`tenants`): criado na primeira criação de agente; `owner_user_id` é o único vínculo usuário→tenant (resolvido por `TenantCacheService`).
- **Agent** (`agents`): pertence a um tenant; único por `[tenant_id, name]`.
- **AgentApiKey** (`agent_api_keys`): a chave `thk_*` do agente. **ApiKey** (`api_keys`): credencial de gestão do tenant, distinta da anterior.
- Os guards resolvem o tenant uma vez por requisição e anexam um `TenantContext` (`@TenantCtx()`). Toda consulta de análise filtra por tenant (`addTenantFilter`). **Nunca** escope, cacheie ou autorize por id de usuário.

Organizações e papéis chegam na v0.3.

## Roteamento e proxy

O proxy (`routing/proxy/`) expõe `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages` e `GET /v1/models`. A resolução (`routing/resolve/resolve.service.ts`) segue esta ordem:

1. **Tier por cabeçalho** (`routing/header-tiers/`): regra com `header_key`/`header_value` (por padrão `x-thinker-tier: <nome>`) tem prioridade.
2. **`model` explícito** no corpo; `auto` significa "roteie".
3. **Complexidade**, se `agents.complexity_routing_enabled` (padrão `false`): `scoring/` classifica em `simple`, `standard`, `complex` ou `reasoning`. Com a opção desligada, tudo vai ao tier `default`.
4. Atribuição de tier → provedor/modelo → encaminhamento.

Um tier pontuado sem modelo cai no tier `default`; se o `default` também não tem rota, é `M101`. Um tier com modelo configurado porém indisponível **não** cai no `default` (aparece `M302`/`M101`).

**Fallback**: cada tier tem um modelo principal e até 5 de reserva (`routing/dto/routing.dto.ts`). Qualquer status HTTP >= 400 (`fallback-status-codes.ts`), timeout de tentativa (`PROVIDER_TIMEOUT_MS`), falta de primeiro trecho (`STREAM_WARMUP_MS`) ou silêncio em streaming (`STREAM_IDLE_TIMEOUT_MS`) leva à próxima rota (`proxy-fallback.service.ts`). Se todas falham, o cliente recebe o erro do provedor da última tentativa (não um código `M###`).

**SSRF**: URLs informadas pelo usuário (provedores customizados, URLs de assinatura) passam por `validatePublicUrl` e por `common/utils/ssrf-safe-fetch.ts` (DNS fixado, endereços de metadata de nuvem sempre recusados). LAN, loopback e `http://` são permitidos (recurso, não falha). Uma URL recusada falha a tentativa com HTTP 502 e `error.code: "provider_url_blocked"`, e o fallback continua. `HTTP_PROXY`/`HTTPS_PROXY` são ignorados nesse caminho.

**Erros do Thinker (`M###`)**: o catálogo está em `common/errors/error-codes.ts` e a documentação para o usuário em [`docs/erros.md`](../erros.md). Levante-os com `ThinkerError`, nunca com `HttpException` pura. Todo código é gravado em uma requisição, exceto `M001`, `M002`, `M003`, `M005` e `M006`, que a guard de chave levanta antes de haver tenant (`UNRECORDABLE_THINKER_CODES`). Um código novo precisa de mapeamento em `THINKER_CODE_TO_REASON` ou de declaração como não gravável (`thinker-error.spec.ts` falha senão) e de uma seção em `docs/erros.md`.

## Gravações

Gravação do corpo das tentativas ao provedor, por harness (ligada em harnesses novos). Variáveis `THINKER_RECORDING_*`:

- `THINKER_RECORDING_STORAGE` (`auto|s3|filesystem|disabled`): em `auto`, credenciais S3 completas ganham; senão usa `THINKER_RECORDING_FILESYSTEM_PATH` (`/data/request-recordings` em produção).
- **Retenção**: `THINKER_RECORDING_RETENTION_DAYS`, padrão **30** (`config/recording-retention.ts`); valor que não seja inteiro positivo derruba o boot. Limpeza diária às 02:00 (`database/request-recording-retention.service.ts`, trava advisory).
- Cifradas com a chave **atual**; a re-cifragem de `PREVIOUS` não as toca. Imagens base64 embutidas são removidas.
- Código: `common/services/request-recording-storage.service.ts`, `common/utils/request-recording-codec.ts` e `routing/proxy/attempt-recording*.ts`.

## Sem phone-home

O produto não faz chamadas de saída próprias: nada de telemetria, verificação de atualização, descoberta ou Sentry. O tráfego de saída vai só para os provedores que o operador configurou, mais a exceção do [ADR 0003](../adr/0003-excecao-catalogos-publicos.md): `openrouter.ai` e `models.dev` (ligados por padrão) e o documento do OpenCode Go em `raw.githubusercontent.com` (só com um provedor OpenCode Go). `THINKER_CATALOG_SYNC=false` desliga os três; os dados embutidos viram o fallback. Também há a busca do documento CIMD de um cliente MCP durante o OAuth (só endereços públicos, salvo `THINKER_CIMD_ALLOW_PRIVATE=true`). Qualquer outro destino exige um novo ADR. Lista voltada ao usuário: [`privacidade.md`](../usuario/privacidade.md).

## Variáveis de ambiente

A referência completa, com padrões e efeitos, é [`docs/usuario/configuracao.md`](../usuario/configuracao.md) (mantenha-a em dia a cada variável nova). O arquivo-modelo é `docker/.env.example` e o repasse ao container fica em `docker/docker-compose.yml`. Variáveis só de desenvolvimento e internas:

| Variável | Uso |
| --- | --- |
| `BIND_ADDRESS` | Interface do servidor (padrão `127.0.0.1`; a imagem define `0.0.0.0`). |
| `CORS_ORIGIN` | Origem do Vite em desenvolvimento (padrão `http://localhost:3000`). |
| `FRONTEND_PORT`, `FRAME_ANCESTORS` | Porta extra confiável para o Better Auth; ancestrais permitidos na CSP (`frame-ancestors`). |
| `SEED_DATA` | Dados de demonstração (dev/teste). |
| `THINKER_E2E_ALLOW_DROP` | Só testes e2e: autoriza apagar o banco de teste. |
| `THINKER_MIGRATION_FORCE` | `1` deixa as migrações de escopo de tenant apagarem linhas órfãs em vez de abortar o boot. Use uma vez, nunca de forma permanente. |
| `THINKER_FRONTEND_DIR`, `THINKER_EMBEDDED` | Internas: caminho do frontend compilado e flag para não iniciar sozinho. |
| `MIGRATION_DATABASE_URL`, `DATABASE_UNPOOLED_URL`, `BACKFILL_DATABASE_URL` | URLs diretas (sem PgBouncer) para migrações e backfills. |
| `BACKFILL_*` | Ajustes do worker de backfill. |
| `SKIP_SSRF_VALIDATION` | Só testes: com `NODE_ENV=test`, pula a validação SSRF salvo se for `false`. |

## CI

Workflows em `.github/workflows/` (ações fixadas por SHA, token somente leitura, sem segredo, exceto o de release):

| Workflow | Gatilho | Conteúdo |
| --- | --- | --- |
| `ci.yml` | PRs e pushes na `main` | Lint, typecheck, build, testes unitários por pacote (o do backend também com `TZ=America/Sao_Paulo`), e2e com PostgreSQL 16 (`TZ=UTC` e `America/Sao_Paulo`), scripts, verificação de changeset |
| `docker.yml` | PRs que tocam a imagem | Build `linux/amd64` e `linux/arm64`, sem publicar |
| `docker-smoke.yml` | PRs que tocam imagem ou compose | Teste de fumaça do Compose (somente leitura) e `install.sh` ponta a ponta |
| `codeql.yml` | PRs, pushes, semanal | Análise de código |
| `dependency-review.yml` | PRs | Revisão de dependências |
| `release.yml` | Tag `vX.Y.Z` ou `vX.Y.Z-rc.N` | Publica a imagem e cria a release (veja abaixo). Único workflow que usa os segredos do Docker Hub. |

Só os checks de `ci.yml` podem ser obrigatórios na `main`, porque os demais são filtrados por caminho.

## Releases e Changesets

Só o pacote `thinker` (`packages/thinker/`) é versionado; ele guarda a versão canônica da imagem. Os demais são `private` e ficam na lista `ignore` de `.changeset/config.json`. Todo changeset aponta para `thinker` (`patch` ou `minor`, nunca `major`); `npm run check:changesets` reprova um que mire um pacote ignorado.

```bash
npx changeset      # selecione "thinker", escolha patch/minor e escreva uma linha de resumo
```

Faça commit do `.changeset/*.md` junto com o código quando houver mudança visível ao usuário. O PR de versão do Changesets (`npm run version-packages`) e a tag são ações do mantenedor.

**Publicação:** um push de tag `vX.Y.Z` (ou `-rc.N`) dispara `release.yml`: confere que a tag bate com `packages/thinker/package.json` e que existe `docs/releases/X.Y.Z.md`, constrói a imagem nativamente em amd64 e arm64, envia por digest ao Docker Hub, junta num manifesto multi-arquitetura com as tags `X.Y.Z`, `X.Y`, `latest` e `sha-<curto>` (as `-rc.N` só recebem `X.Y.Z-rc.N` e `sha-<curto>`) e cria a release no GitHub com as notas em português. A CLI (`thinker-cli`) acompanha a versão do Thinker: `npm run set-version --workspace=packages/cli` carimba o número.

Notas de release (PT-BR) ficam em `docs/releases/X.Y.Z.md`, montadas a partir dos changesets e dos PRs integrados.

## Fluxo de trabalho: merge e agentes

O Thinker é desenvolvido por agentes do Claude Code. O **Principal** (guiado por `CLAUDE.md`) conversa com o mantenedor, planeja e delega aos subagentes de `.claude/agents/`; a tabela completa e o ciclo de vida de um agente novo estão em [`docs/agentes.md`](../agentes.md).

| Necessidade | Agente |
| --- | --- |
| O que mudou no upstream | `manifest-tracker` |
| Desenho de feature grande, ADR | `architect` |
| NestJS, TypeORM, auth, proxy | `backend-dev` |
| Dashboard SolidJS | `frontend-dev` |
| Adaptadores, catálogos, preços, OAuth de assinatura | `providers` |
| Imagem em Docker local, smoke e e2e | `qa-docker` |
| Revisão de PR | `reviewer` |
| CI, Dockerfile, imagem multi-arquitetura, releases, templates de deploy | `devops` |
| Documentação e notas de release em português | `docs-ptbr` |

**Política de merge** ([ADR 0002](../adr/0002-politica-de-merge.md)): a `main` é protegida; todo trabalho vai em branch com PR (Conventional Commits). O Principal faz o squash merge quando os três gates passam:

1. CI verde (até a CI existir, os testes locais dos pacotes afetados são registrados no PR);
2. o `reviewer` publicou `Veredito: aprovado` para o SHA do head atual (commit novo exige nova revisão; cada *should-fix* é corrigido ou vira issue);
3. `qa-docker` aprovado, quando o comportamento em tempo de execução mudou.

```bash
gh pr merge <n> --squash --delete-branch --match-head-commit <sha-revisado>
```

Esperam o mantenedor: decisões de produto novas e ADRs que mudam uma anterior; arquivos de governança (`CLAUDE.md`, `.claude/settings.json`, `.claude/agents/**`, `docs/adr/**`, `docs/decisoes-iniciais.md`); releases (tags, GitHub Releases, Docker Hub, PR de versão, qualquer merge que publique); e `Veredito: risco alto`. **Nunca**: push na `main`, force push, `gh pr merge --admin` ou contornar a proteção pela API. Texto livre que possa citar push, `main`, merge ou `--admin` vai por arquivo (`git commit -F`, `--body-file`).

Regras adicionais para quem contribui: nenhum destino de saída novo sem ADR; nunca manipule tokens ou chaves reais; testes e2e só pelo `test:e2e:docker`; trabalhe em um worktree próprio quando houver agentes em paralelo.
