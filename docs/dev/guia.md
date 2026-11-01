# Guia do desenvolvedor do Thinker

Guia técnico do repositório: arquitetura, comandos, autenticação, roteamento, gravações, migrações, testes, CI, releases e o fluxo de trabalho com agentes. Para o uso do produto, veja [`docs/usuario/`](../usuario/instalacao-docker.md). A terminologia de domínio está em [`terminologia.md`](terminologia.md). As decisões do projeto estão em [`decisoes-iniciais.md`](../decisoes-iniciais.md) e em [`docs/adr/`](../adr/).

O Thinker começou como um snapshot sem histórico de [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) (`manifest@6.28.6`) e evolui de forma independente; não há obrigação de compatibilidade com o Manifest. Convenções de nome: variáveis `THINKER_*`, prefixo de chave `thk_`, CLI `thinker`, imagem `tmsoftbrasil/thinker`, porta `2099`. Nunca crie identificadores novos com `manifest`/`mnfst`.

> Língua: código, identificadores, comentários, commits e PRs em inglês; documentação em `docs/` e notas de release em português. O dashboard tem inglês (referência) e português do Brasil desde a v0.3 (#42); veja [Traduções do dashboard](#traduções-do-dashboard-42).

## O que é

O Thinker é um gateway de LLM auto-hospedado. Ele fica entre agentes ("harnesses") e provedores de inferência, escolhe o modelo de cada requisição e registra custo, tokens e corpo das chamadas. No dashboard, "Harness" é o nome de um agente (rotas `/harnesses`); no backend, no banco e na API continua `agent`.

Três superfícies de gestão compartilham a mesma API REST (`/api/v1/*`): o dashboard, a CLI `thinker` (`packages/cli/`) e o servidor MCP remoto (`packages/backend/src/mcp/`). Adicione a capacidade uma vez na camada de serviço e exponha onde precisar; nunca duplique a lógica por superfície.

## Arquitetura

Monorepo com npm workspaces e Turborepo:

```text
packages/
├── shared/     thinker-shared    tipos e helpers usados por backend, frontend e CLI (provedores, tiers, snippets)
├── backend/    thinker-backend   NestJS 12, TypeORM 1.1, PostgreSQL 18, Better Auth
├── frontend/   thinker-frontend  React 19 + Vite + Tailwind 4, dashboard
├── cli/        thinker-cli       CLI `thinker` (privada, não publicada)
└── thinker/    thinker           pacote sem código que guarda a versão canônica
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
| `routing/` | Provedores, tiers, resolução, proxy (`/v1/*`), fallback, OAuth de assinaturas, provedores customizados, modelos virtuais |
| `scoring/` | Pontuação de complexidade das requisições |
| `model-discovery/`, `model-prices/` | Descoberta de modelos por provedor e preços |
| `analytics/` | Análises do dashboard (visão geral, tokens, custos, requisições) |
| `notifications/` | Regras de limite (alerta e bloqueio); a entrega vai pelos gatilhos |
| `triggers/` | Gatilhos de eventos: cadastro, vínculos, fila, worker e envio (e-mail, webhook, Telegram, Syslog) |
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
npm run typecheck --workspaces --if-present   # TypeScript 6 (tsc6)
npm run typecheck:ts7                          # TypeScript 7 (tsgo), só --noEmit
npm test                                       # turbo test, todos os pacotes
npm run test:scripts                           # testes dos scripts do repositório
```

### TypeScript 6 e 7

O repositório tem dois compiladores lado a lado (#87, opção B):

| Pacote no `package.json` | Instala | Binário | Uso |
| --- | --- | --- | --- |
| `typescript` = `npm:@typescript/typescript6@^6.0.2` | TypeScript 6 (o `@typescript/typescript6` reexporta o `typescript@6` instalado como `@typescript/old`) | `tsc6` | emissão (`shared`, `cli`), `nest build`, `ts-jest`, `typescript-eslint`, `ts-node` (migrações e backfills) e o `typecheck` |
| `@typescript/native` = `npm:typescript@^7.0.2` (só na raiz) | TypeScript 7, o compilador nativo (`tsgo`) | via `scripts/tsgo.mjs` | só `typecheck:ts7`, sempre com `--noEmit` |

**Nunca chame `tsc` puro.** O `typescript@7` e o `typescript@6` (`@typescript/old`) declaram os dois um binário `tsc`, e o npm liga em `node_modules/.bin/tsc` o que processar por último; o resultado muda de uma instalação para outra. Use `tsc6` para o TypeScript 6 e `node scripts/tsgo.mjs ... --noEmit` para o 7 (o script recusa rodar sem `--noEmit` e confere que achou a versão 7). Os dois leem os mesmos `tsconfig*.json`. O job `Typecheck (TypeScript 7)` da CI roda `npm run typecheck:ts7`.

O `@typescript/native` é devDependency da raiz, então o `--omit=dev` não o leva para a imagem. O TypeScript 6 entra na árvore de produção como peer do `ts-node` (via `typeorm`), e o estágio `prod-deps` do `docker/Dockerfile` apaga `node_modules/typescript` e `node_modules/@typescript`.

**Adiado do TypeScript 7** (#87; acompanhamento em #230):

- **Emitir JS com o `tsgo`** (opção C, descartada): poria na imagem um JS de outro compilador, com risco alto e pouco ganho. O build continua no `tsc6` e no `nest build`.
- **Ferramentas no TS 7:** o TypeScript 7.0 não tem API programática (a nova chega no 7.1 e é diferente da atual). Por isso `ts-jest` (peer `typescript <7`), `typescript-eslint` (peer `<6.1.0`), `ts-node` (usa a API) e o `@nestjs/cli` (depende de `typescript ~6.0.2`) continuam no TS 6 pelo alias.
- **Critérios de reabertura:** API do TS 7.1 estável; `ts-jest`, `typescript-eslint` e `@nestjs/cli` com suporte declarado ao 7; um substituto para o `ts-node` nas migrações e backfills. Trocar `ts-jest` por Vitest/SWC ou `ts-node` por `tsx` só para viabilizar o TS 7 vira issue própria.
- **Dependabot e aliases `npm:`:** não confirmado se o Dependabot atualiza dependências declaradas como alias (`npm:pacote@faixa`). Fica para #97 conferir e, se preciso, ajustar a entrada do `typescript` no `.github/dependabot.yml`.

### Servidor de desenvolvimento

O backend precisa de um `packages/backend/.env` com, no mínimo, `BETTER_AUTH_SECRET` e `THINKER_ENCRYPTION_KEY` (32+ caracteres, valores diferentes) e `DATABASE_URL`. O `auth.instance.ts` lê `process.env` na importação, antes do `ConfigModule`, por isso o `.env` é pré-carregado pela opção `--env-file` do `nest start` (o Node lê o arquivo nativamente; o projeto não depende do `dotenv`):

```bash
# backend
cd packages/backend && npx nest start --watch --env-file .env
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

**NestJS 12 é só ESM.** O backend continua CommonJS e carrega os `@nestjs/*` por `require(esm)`, que o Node faz nativamente (20.19+, 22.12+ e 24). No Jest, isso depende da API `vm` de módulos, que fica atrás de `--experimental-vm-modules`; por isso os scripts `test`, `test:watch` e `test:e2e` do backend acrescentam essa flag ao `NODE_OPTIONS`. Rode o Jest sempre por esses scripts (ou passe a flag você mesmo): `npx jest` puro falha com `Must use import to load ES Module`. Pelo guia oficial, a CLI e os schematics do Nest 12 pedem Node 24.15+ (as imagens fixadas no `docker/Dockerfile` usam a 24.22).

**TypeORM 1.x: `null`/`undefined` no `where` lança erro.** As APIs de alto nível (`find*`, `count*`, `exists*`, `update`, `delete`, `setFindOptions`) recusam `null` ou `undefined` num filtro, em vez de ignorar a propriedade como a 0.3 fazia (o que transformava um `tenant_id` ausente em "sem filtro"). A regra está fixada em `INVALID_WHERE_VALUES_BEHAVIOR` (`database/data-source-definitions.ts`) e vale para o app, o CLI de migrações e o e2e; nunca a troque por `ignore`. Para buscar `NULL`, use `IsNull()`; para um filtro opcional, só inclua a chave quando houver valor. O `.where()` do QueryBuilder não passa por essa checagem. `select` e `relations` usam só a forma de objeto (`{ id: true }`).

Os CLIs avulsos (migrações e backfills) carregam o `.env` com `process.loadEnvFile()` em `src/database/load-env-file.ts`; o projeto não depende do `dotenv`.

**E2E só por `test:e2e:docker`.** A suíte usa `dropSchema: true` (apaga o banco). O script `packages/backend/scripts/test-e2e-docker.mjs` escolhe uma porta livre em `127.0.0.1`, sobe um `postgres:18-alpine` com nome único e dados em tmpfs montado em `/var/lib/postgresql` (banco `thinker_e2e_test`), roda as migrações, executa a suíte em série e remove o contêiner no fim (sucesso, falha ou Ctrl-C). A imagem é a mesma, com o mesmo digest, de `docker/docker-compose.yml` e do job `Backend e2e (PostgreSQL)` da CI (`THINKER_E2E_PG_IMAGE` troca a imagem). Ao atualizar o digest, atualize os três lugares e `deploy/coolify/docker-compose.yml`. Argumentos extras vão para o Jest:

```bash
npm run test:e2e:docker --workspace=packages/backend -- test/limits.e2e-spec.ts
TZ=America/Sao_Paulo npm run test:e2e:docker --workspace=packages/backend
```

Uma proteção (`packages/backend/test/e2e-db-guard.ts`) recusa rodar sem `DATABASE_URL`, sem `THINKER_E2E_ALLOW_DROP=1` ou se o nome do banco não tiver `test` como token separado. Um teste de varredura (`e2e-db-guard-scan.spec.ts`) falha se um spec novo apagar o banco sem passar pela proteção, usar `DATABASE_URL ?? ...` ou citar `localhost:5432`. Os testes e2e nunca falam com a internet. Para um PostgreSQL seu: `DATABASE_URL=postgresql://.../thinker_e2e_test THINKER_E2E_ALLOW_DROP=1 npm run test:e2e --workspace=packages/backend`, nunca contra um banco de desenvolvimento.

Qualquer mudança de comportamento em tempo de execução também passa pelo agente `qa-docker`, contra a imagem construída localmente.

### Dashboard (console)

O dashboard é React 19 com react-router 7, Vite e Tailwind 4 ([ADR 0007](../adr/0007-console-react.md)). As peças que toda tela usa:

- **Shell** (`src/App.tsx`, `src/components/shell/`): sidebar com ícones e labels, recolhível pelo botão à direita da logomarca, que toma o lugar dela quando recolhida (a escolha fica em `localStorage`, `thinker.sidebarCollapsed`; abaixo de 900 px vira gaveta); barra superior com o título da página e o ícone do menu (`activeNavItem`, que também cobre as páginas do menu do usuário em `USER_MENU_PAGES`), a versão e os ícones Documentação, Procurar, Alterar tema e Alertas. As páginas não repetem o título no conteúdo: o `page-head` só aparece quando há ações; menu do usuário no rodapé da sidebar, com a organização atual, a troca e a criação de organizações, membros, administração de usuários, integrações (MCP e CLI), preferências da conta e sair.
- **Menu principal:** um arquivo só, `src/config/navigation.tsx`. A sidebar, a trilha e o "Ir para" da paleta ⌘K leem dele.
- **Paleta ⌘K** (`CommandPalette.tsx`): páginas e ações filtradas no navegador, mais `GET /api/v1/search?q=` (mínimo 2 caracteres), que procura na organização ativa harnesses, conexões, provedores custom, modelos virtuais, modelos do catálogo e membros (`backend/src/console/`).
- **Alertas** (`AlertsMenu.tsx`): `GET /api/v1/alerts`, as requisições com falha das últimas 24 horas. O contador mostra as mais novas que a última abertura, guardada no navegador (`thinker.alertsSeenAt`); cada item abre a requisição em `/messages?request=<id>`.
- **Tema:** claro, escuro ou o do sistema (`src/lib/theme.ts`, chave `theme` no `localStorage`, aplicada antes da pintura por `public/theme-init.js`). O ícone do topo alterna entre claro e escuro; Preferências da conta oferece também "sistema".
- **Estado e dados:** stores globais são `signal()` com `useSignal()` (`src/lib/signal.ts`); telas carregam dados com `useResource(fetcher, deps)` (`src/lib/use-resource.ts`), que descarta respostas atrasadas. Os pings do SSE (`services/sse.ts`) entram como dependência para recarregar.
- **Estilo:** tokens por papel em `src/styles/tokens.css` (fundos, fios, quatro níveis de texto, um acento azul, estados, portas e séries de gráfico, nos dois temas) e as classes de `base.css`/`shell.css`. Componentes usam os primitivos de `src/components/ui.tsx` e utilitários Tailwind ligados aos tokens (`bg-elev`, `text-muted`, `border-line`...); nada de hex nem de `dark:` para cor.
- **Fluxo (React Flow):** `src/components/flow/` traz o palco (`FlowCanvas`), os nós (entrada, roteamento, provedor, pool), as arestas (animadas quando há tráfego) e o auto layout em colunas. A página `/topology` usa o palco e carrega num chunk próprio.
- **Topologia** (`pages/Topology.tsx` e `pages/topology-adapter.ts`): `GET /api/v1/topology?range=1h|24h|7d|30d` (`console/topology.service.ts`) devolve, só da organização ativa, os harnesses, os pontos de roteamento de cada um (auto, que reúne tiers e especificidade ativa; modelos virtuais), os provedores alcançados pelas rotas ou pelo uso (agrupados por provedor e tipo de autenticação, com as conexões) e as ligações com o tráfego da janela, contado em `agent_messages`. Traz também os IPs dos clientes que chamaram cada harness na janela: o proxy grava o endereço resolvido (`common/utils/client-ip.ts`, com `TRUSTED_PROXIES`) em `caller_attribution.clientIp`, junto de `clientIpSource` e `peerIp`, e a topologia o extrai desse JSON. O adaptador transforma isso em nós (IP do cliente, numa linha com o contador de requisições → harness → modelo virtual → provedor, ou pool quando há várias conexões) e arestas coloridas por tipo: rota principal, fallback e "usado, sem rota". Cada nó de modelo virtual lista seus modelos finais, cada um com a própria ponta de conexão (`route:<provedor>><modelo>`) ligada ao provedor que o serve. As arestas com tráfego animam e ficam vermelhas quando metade ou mais falhou. A página recarrega a cada nova requisição (SSE), guarda o período no navegador (`thinker.topologyRange`), tem o filtro "Só com tráfego" e abre o objeto com clique duplo.

### Traduções do dashboard (#42)

O dashboard fala inglês (`en`, referência e fallback) e português do Brasil (`pt-BR`), com um `t()` próprio e tipado (`packages/frontend/src/i18n/index.ts`). Os catálogos vão no bundle: nada é baixado em tempo de execução.

- **Onde ficam:** `packages/frontend/src/i18n/locales/{en,pt-BR}/<namespace>.ts`, um arquivo por área (`common`, `nav`, `auth`, `org`, `routing`, `providers`...). O `pt-BR` é tipado como `Catalog<typeof en>`, então o typecheck acusa chave faltando.
- **No código:** `t('routing.title')`, com `{{ nome }}` preenchido pelo segundo argumento (`t('format.minutesAgo', { n: 5 })`). Plurais são funções no catálogo, com a mesma assinatura nos dois idiomas. Chaves montadas em tempo de execução usam `tMaybe`, que devolve `undefined` quando a chave não existe. A árvore do app é remontada quando o idioma muda, então basta chamar `t()` na renderização; constantes de módulo guardam chaves, não textos. Plurais recebem os argumentos na ordem do catálogo (`t('shell.alerts.labelUnseen', 3)`).
- **Datas, números e moeda:** sempre por `Intl` com `intlLocale()` ou pelos helpers de `services/formatters.ts` (`formatCost`, `usd`, `formatNumber`, `formatTime`). Em inglês a saída continua `en-US`.
- **Idioma escolhido:** em Preferências da conta (`/account`). O padrão vem do navegador (`pt*` → `pt-BR`, senão `en`). A escolha fica no `localStorage` (`thinker.locale.<userId>`, mais `thinker.locale` para as telas de login) e volta depois de um novo login. Ainda não há preferência no backend, então ela vale por navegador.
- **Fica em inglês:** nomes de marca, provedor e modelo, comandos e trechos de código, variáveis de ambiente, URLs e mensagens de erro vindas da API.

Fluxo para mudar ou criar um texto:

1. Adicione a chave no arquivo `en` da área e a tradução no `pt-BR` correspondente. Use o glossário do PT-BR já adotado: harness, provedor, requisição, tentativa, token, chave de API, fallback, roteamento, nível, modelo virtual, organização, papel.
2. Rode `npm run check:i18n --workspace=thinker-frontend` (também roda no `npm run lint` do frontend e no CI). Ele falha quando uma chave existe em `en` e falta em `pt-BR` (ou o contrário, ou os `{{ }}` diferem) e quando um componente mostra texto fora do catálogo: texto JSX, `placeholder`/`title`/`aria-label`/`alt`/`label`, literais no JSX e toasts. Um literal que precisa ficar como está leva um comentário `i18n-ignore` na mesma linha ou na anterior.
3. Os testes rodam em inglês por padrão (`tests/setup.ts`). Para conferir uma tela em português, chame `resetLocaleForTests('pt-BR')` (exemplos em `packages/frontend/tests/i18n/`).

### Relógio: tudo em UTC (#58)

As colunas de data são `timestamp without time zone` e recebem valores do Node (o driver `pg` serializa um `Date` no fuso do processo), do PostgreSQL (`NOW()`/`CURRENT_TIMESTAMP`, no fuso da sessão) e de `toSqlTimestamp` (UTC). Para que concordem, o Thinker fixa os dois relógios em UTC (`common/utils/utc-clock.ts`):

- **processo:** `import './common/utils/pin-utc'` é o primeiro import de `main.ts`; os CLIs de migração e backfill fixam o fuso em `database/load-env-file.ts`. Um `TZ` do operador é ignorado, com aviso no boot;
- **sessão:** `pinSessionTimeZoneToUtc` é o `onConnect` dos pools `pg` do TypeORM (`database.module.ts`), do CLI de migrações e do Better Auth. Todo `DataSource` ou `Pool` novo precisa do mesmo `onConnect`.

Alguns utilitários antigos (`postgres-sql.ts`, `query-helpers.ts`) ainda formatam datas com os getters locais (`getHours`…) e falam em "fuso local" nos comentários. Estão corretos só porque o fuso local é UTC pelo pin: um processo novo sem `pin-utc` quebra os cortes e buckets deles.

Não há migração de dados: o container padrão já roda em UTC.

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
- Importe a nova migração em `database/data-source-definitions.ts` e inclua-a no array `migrations` (o spec `data-source-definitions.spec.ts` falha se faltar). Entidades novas entram no array `entities` do mesmo arquivo, no `TypeOrmModule.forFeature` de `database.module.ts` e na lista de `test/helpers.ts`.
- O modo de transação é `each` (uma transação por migração), porque algumas migrações de índice usam `CONCURRENTLY`.
- Migrações costumam ter um spec ao lado; mudanças de dados ganham também um e2e.
- As tabelas do Better Auth têm migrações próprias, geridas por ele: `DatabaseSeederService` chama `ctx.runMigrations()` no boot. A checagem de schema do Better Auth na inicialização (`advanced.database.validateSchema`) fica desligada, porque roda antes dessa migração e registrava um falso "Database schema mismatch" em todo banco novo. `auth/better-auth-schema.ts` faz a mesma checagem logo depois da migração e só registra ERROR quando há divergência real.

## Autenticação

Quatro guards globais, nesta ordem:

1. **SessionGuard** (`auth/session.guard.ts`): respeita `@Public()`; valida o cookie de sessão do Better Auth.
2. **ApiKeyGuard** (`common/guards/api-key.guard.ts`): sem sessão, lê `X-API-Key` e procura na tabela `api_keys` (hash scrypt, escopo de tenant). Só se não achar compara, em tempo constante, com a variável `API_KEY`. Os tokens da CLI (`thinker login`) são linhas de `api_keys` chamadas `cli`, com TTL deslizante (`CLI_TOKEN_TTL_DAYS`, 30) e teto absoluto (`CLI_TOKEN_ABSOLUTE_TTL_DAYS`, 90).
3. **RolesGuard** (`common/guards/roles.guard.ts`): papel na organização ativa (ADR 0006). Leituras pedem `viewer`; os demais métodos, `member`. `@MinRole('admin')` sobe a exigência das mutações (provedores, credenciais, roteamento, notificações); com `{ includeReads: true }` vale também para GET (início de OAuth). `@InstanceAdminOnly()` restringe ao admin da instância.
4. **ThrottlerGuard**: limite de requisições (`THROTTLE_*`); o proxy `/v1/*` e o SSE ficam fora (`@SkipThrottle()`), pois têm limites próprios (`THINKER_RATE_MAX_REQUESTS`, `THINKER_IP_RATE_MAX_REQUESTS`, `THINKER_CONCURRENCY_MAX`).

As rotas `/v1/*` usam a chave do harness (`AgentKeyAuthGuard`, em `otlp/guards/`), em `Authorization: Bearer thk_...` ou `x-api-key`. Chaves diferentes nos dois cabeçalhos dão `M006`. A verificação consulta o banco a cada requisição para que rotação e exclusão valham em todas as réplicas; o contexto verificado fica em cache de 5 minutos.

**Better Auth** (`auth/auth.instance.ts`): e-mail/senha, Google, GitHub e Discord (cada um liga quando `CLIENT_ID` e `CLIENT_SECRET` estão definidos) e os plugins `jwt()` e `mcp()` (servidor de autorização OAuth 2.1 do MCP). É montado como middleware Express em `/api/auth/*splat`, **antes** de `express.json()`. `auth.instance.ts` é só ESM e não carrega no Jest; por isso constantes como `auth/mcp-scopes.ts` e `auth/mcp-availability.ts` ficam em módulos folha.

**Cadastro fechado** (#29): ninguém cria conta pela API pública. `auth/signup-policy.ts` decide e `auth.instance.ts` impõe em `databaseHooks.user.create.before` (cobre e-mail, social e plugins), com um `hooks.before` em `/sign-up/email`. A recusa é `403 { code: 'SIGNUP_DISABLED' }`; provedores sociais têm `disableSignUp`. O primeiro usuário só nasce no assistente (`setup/setup.service.ts`, trava advisory `9001`), dentro de `runAsServerUserCreation`, uma marca em `AsyncLocalStorage` que nenhuma requisição HTTP consegue definir. `THINKER_ALLOW_SIGNUP=true` é uma válvula provisória (removida na v0.3) que reabre o cadastro depois que o primeiro administrador existe; `GET /api/v1/setup/status` a expõe como `signupEnabled`.

**Token de setup** (#29): sem nenhum usuário no boot, `setup/setup-token.service.ts` gera um token aleatório, guarda só o SHA-256 na memória e imprime o token no log (`No admin account exists yet. Open /setup and enter this one-time setup token: ...`). `POST /api/v1/setup/admin` exige o token em `setupToken` (403 sem ele ou com valor errado; um token novo é impresso se nenhum está pendente). Ele é consumido ao criar o primeiro administrador. Cada processo tem o seu token, então com várias réplicas o primeiro setup precisa ir à réplica que o imprimiu.

**Cifragem em repouso**: `THINKER_ENCRYPTION_KEY` (obrigatória, 32+ caracteres, diferente de `BETTER_AUTH_SECRET`, sem fallback; `assertEncryptionKeyConfig` barra o boot) cifra com AES-256-GCM as chaves de provedores, os tokens OAuth e as gravações (`common/utils/crypto.util.ts`). `THINKER_ENCRYPTION_KEY_PREVIOUS` serve para rotação: no boot, `database/secret-reencryption.service.ts` regrava com a chave nova o que estava sob a antiga (com trava advisory) e registra `Secret re-encryption complete` e, quando nada sobrou, `Nothing left under an older secret`. A mesma receita migra instalações que usavam o antigo fallback para `BETTER_AUTH_SECRET`: chave nova em `THINKER_ENCRYPTION_KEY`, o valor antigo de `BETTER_AUTH_SECRET` em `THINKER_ENCRYPTION_KEY_PREVIOUS`, subir, esperar o log e remover a variável. As gravações **não** são regravadas.

**IP do cliente** (skill `docker-reverse-proxy-real-ip-address`): `common/utils/client-ip.ts` carrega no boot o conjunto de proxies confiáveis (faixas privadas e reservadas, ou só os prefixos de `TRUSTED_PROXIES`; uma entrada inválida barra o boot) e resolve o endereço de cada requisição: se o peer TCP não é confiável, vale ele e os cabeçalhos são ignorados; se é, `X-Forwarded-For` percorrido da direita para a esquerda (até 2048 caracteres e 30 saltos; uma entrada inválida descarta o XFF), depois `X-Real-IP`, por fim o peer, com aviso limitado a um por minuto. `clientIpMiddleware` é o primeiro middleware do app: fixa `req.ip` no resultado (throttler, limites por IP e guards concordam) e grava `x-thinker-client-ip`, `x-thinker-client-ip-source` e `x-thinker-peer-ip` (sobrescrevendo o que o cliente mandou), que o Better Auth usa em `advanced.ipAddress.ipAddressHeaders` e nas colunas extras de sessão `ipAddressSource` e `peerIpAddress`. O `trust proxy` do Express usa o mesmo conjunto (para `X-Forwarded-Proto`). Os logs trazem `client_ip`, `client_ip_source` e `peer_ip` (`clientIpLogFields`), e o proxy grava os três em `caller_attribution`, junto de `peerPort` (porta TCP de origem da conexão que chegou ao contêiner). A listagem de Requisições extrai `clientIp` numa coluna própria. Os "Headers de requisição" (`request_headers`, `routing/proxy/request-headers.ts`) guardam todos os cabeçalhos exatamente como chegaram (montados de `req.rawHeaders`, então incluem `X-Forwarded-For`, `Host`, `Forwarded` etc. e não incluem os `x-thinker-*` gravados pelo middleware); credenciais (`authorization`, `cookie`, `x-api-key`…) aparecem com o valor trocado por `[REDACTED]`, preservando só o esquema de autenticação. O detalhe da requisição (`GET /api/v1/messages/:id/details`) só devolve esses cabeçalhos, da requisição e de cada tentativa, a `owner` e `admin` da organização (e ao admin da instância); para `member` e `viewer` o backend manda `request_headers: null` e a aba não aparece. `TRUST_PROXY` não é mais lido; o boot avisa se estiver definida.

**Linha do tempo da requisição** (`routing/proxy/request-timeline.ts`): `clientIpMiddleware` marca o primeiro contato HTTP (`common/utils/request-received.ts`); o `ProviderClient` marca, por tentativa, o envio ao provedor (logo antes do fetch), a chegada dos cabeçalhos e o primeiro e o último chunk do corpo (o corpo passa por um `TransformStream` que conta chunks e bytes); o controller marca o início (`writeHead`) e a conclusão (`finish`) da resposta ao harness. No `close` da conexão tudo vira `requests.timeline` (jsonb, eventos com `at` em epoch ms, migração `AddRequestTimeline1804200000000`). O painel de detalhes (`components/RequestDrawer.tsx`) mostra na guia Detalhes as seções Origem (IP oficial, fonte, IP:porta da conexão), Linha do tempo (`components/RequestTimelineChart.tsx`) e Headers da requisição. As demais guias ficam em `components/RequestAttemptViews.tsx`: Requisição (parâmetros e conversa), Resposta (partes em ordem: pensamento, texto, recusa, chamadas de ferramenta, e os eventos do stream, lidas por `lib/response-parts.ts` para OpenAI, Responses, Anthropic e Gemini), Ferramentas (assinatura `function nome(tipo arg, tipo opcional?)`, obrigatórios em laranja, e quais foram chamadas) e Bruto (`components/JsonExplorer.tsx`: árvore navegável com busca e cópia de caminho/valor). O proxy grava a metade da requisição assim que ela é montada e a gravação completa no fim (a final espera a parcial), e o painel consulta de novo a cada 1,5 s enquanto a requisição está pendente; os detalhes nunca passam pelo cache SWR. O painel pode virar janela flutuante (arrastável, redimensionável, minimizável) ou abrir em nova guia na rota `/requests/:id` (`pages/RequestPage.tsx`, tela inteira). O gráfico da linha do tempo: gráfico por raia (Thinker e cada tentativa) com a duração de ponta a ponta e uma tabela com timestamp em milissegundos, tempo desde o início e intervalo entre eventos.

Nomes herdados: `common/utils/legacy-env.ts` registra no boot um aviso com o nome (nunca o valor) de cada variável `MANIFEST_*` ainda definida e recusa iniciar se `MANIFEST_ENCRYPTION_KEY` estiver definida sem `THINKER_ENCRYPTION_KEY`.

## Multi-tenancy

```text
Usuário (Better Auth) ──→ organization_members ──→ Tenant (organização) ──→ Agent ──→ AgentApiKey (thk_*)
                                                                             └──→ requests ──→ agent_messages
```

- **Organização = tenant** (`tenants`, [ADR 0006](../adr/0006-organizacoes-e-papeis.md)). O nome visível é `organization_name`. `owner_user_id` é legado e não é mais lido na resolução.
- **Membros** (`organization_members`): `(tenant_id, user_id, role)`, papéis `viewer < member < admin < owner`. Um usuário pode estar em várias organizações.
- **Perfil** (`user_profiles`): `is_instance_admin`, `must_change_password` e `active_tenant_id`.
- **Resolução** (`TenantCacheService.resolveAccess`, cache de 5 min invalidado em toda mudança de membro ou perfil): cabeçalho `X-Thinker-Organization`, senão `active_tenant_id`, senão a primeira associação. Organização pedida sem associação dá 403, exceto para o admin da instância, que entra como `owner`. Sem organização nenhuma, a primeira mutação cria uma pessoal (`ensureForUser`).
- Os guards anexam um `TenantContext` (`@TenantCtx()`) com `tenantId`, `userId`, `role`, `isInstanceAdmin` e `mustChangePassword`. Toda consulta filtra por tenant (`addTenantFilter`). O filtro por harness (`agent_name`) do log de requisições é resolvido uma vez por requisição para o id do agente vivo (`resolveAgentScope`, em `query-helpers.ts`) e reutilizado em todas as consultas; os caches de resultado usam o tenant mais o id resolvido (`agentScopeCacheKey`), nunca só o nome. **Nunca** escope, cacheie ou autorize por id de usuário. **Nunca** escope, cacheie ou autorize por id de usuário.
- Chaves de CLI (`api_keys`) carregam o papel atual de quem as criou naquela organização. O MCP limita as ferramentas de escrita pelo papel (`canWrite` em `mcp/mcp-auth.ts`: agentes pedem `member`; provedores e roteamento, `admin`).
- **Contas** (`organizations/`): o admin da instância e owner/admin de uma organização criam contas com senha temporária (`AccountsService`, via `runAsServerUserCreation`). Enquanto `must_change_password` estiver ligado, o `SessionGuard` só deixa passar `GET /api/v1/me` e `POST /api/v1/me/password` (403 `password_change_required`). A redefinição pelo admin apaga as linhas de `session`, mas o cookie cache do Better Auth (5 min) mantém o cookie antigo válido nesse intervalo; como a flag volta a ligar e a troca exige a senha atual, esse cookie não faz nada além de ler `/me`.
- **Agent** (`agents`): pertence a um tenant; único por `[tenant_id, name]`.
- **AgentApiKey** (`agent_api_keys`): a chave `thk_*` do agente. **ApiKey** (`api_keys`): credencial de gestão do tenant, distinta da anterior.

## Roteamento e proxy

O proxy (`routing/proxy/`) expõe `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages` e `GET /v1/models`. A precedência fica em `ProxyService.resolveRouting` ([ADR 0004](../adr/0004-modelos-virtuais-por-harness.md), seção 5):

1. **Modelo virtual** (`ResolveService.resolveVirtualModel`): um virtual ativo do agente cujo nome é igual ao `model`, sem diferenciar maiúsculas e sem outra normalização.
2. **`auto`** → um heartbeat (`auto` com `HEARTBEAT_OK`) vai direto ao tier `simple`; os demais vão a `resolveLazy`: complexidade, se `agents.complexity_routing_enabled` (padrão `false`), com `scoring/` classificando em `simple`, `standard`, `complex` ou `reasoning`; com a opção desligada, tudo vai ao tier `default`. **ID real** → rota explícita (`resolveExplicitModel`). **Desconhecido** → `M302`.

Os tiers por cabeçalho (regras `x-thinker-tier`, tabela `header_tiers`, API `/header-tiers`) foram descontinuados ([ADR 0008](../adr/0008-descontinuar-tiers-por-cabecalho.md)); a migração `DropHeaderTiers1804100000000` apaga a tabela, as colunas `agent_messages.header_tier_*` e os parâmetros com escopo `header:<id>`.

Um tier pontuado sem modelo cai no tier `default`; se o `default` também não tem rota, é `M101`. Um tier com modelo configurado porém indisponível **não** cai no `default` (aparece `M302`/`M101`).

**Modelos virtuais** ([ADR 0004](../adr/0004-modelos-virtuais-por-harness.md), `routing/virtual-models/`): nomes públicos por harness (tabela `virtual_models`), cada um com principal, até 5 fallbacks, `continue_on_default`, `response_mode` e `output_modality`. A API administrativa fica em `/api/v1/routing/:agentName/virtual-models` (CRUD, `toggle`, `reorder`, `override`, `fallbacks`, `response-mode`); o `GET /v1/models` publica os ativos logo depois de `auto`, com `context_length`. Regras:

- **No proxy**, `resolveVirtualModel` monta a cadeia com `buildVirtualModelChain` (`enrichRouteKeyLabel` como `normalize`, antes da deduplicação por `(provider, authType, model, keyLabel)`; `isRouteAvailable` decide se o override do Default está disponível). As rotas do virtual passam por `isRouteAvailable`; a parte do Default segue `buildResolvedRouteChain` (override disponível ou primeira rota com credencial na frente, as demais com `isRouteAvailable`). Depois vem o filtro de transporte com o `response_mode` do virtual. Não passa pelo scorer, pela especificidade nem pelo momentum. Sem rota, `M301`, sem queda para outra regra.
- **Observabilidade:** `X-Thinker-Reason: virtual-model`, `X-Thinker-Virtual-Model: <nome>`, `X-Thinker-Tier: default` e os `X-Thinker-Fallback-*` de sempre (a lista completa dos cabeçalhos, em `buildMetaHeaders`, está em [Provedores e roteamento](../usuario/provedores-e-roteamento.md#cabeçalhos-de-resposta-x-thinker)). Toda linha de `agent_messages` do pedido (pendente, tentativas, sucesso, erros, `M301`) grava `virtual_model_id` e `virtual_model_name`; o `routing_reason` é `virtual-model` (ou `virtual_model_unavailable` no `M301`).
- **Parâmetros por modelo** são escopados por rota: `ParamMergeContext.scopeFor(route)` responde `virtual:<id>` para as rotas do virtual e `tier:default` para as que vieram do Default (`route_params_scopes` no `ResolveResponse`). O mesmo vale para o snapshot `request_params`, que cada linha de `agent_messages` guarda por tentativa, sob o escopo da própria rota: o principal (`RoutingMeta.primaryRequestParams`) e cada fallback que falhou (`FailedFallback.requestParams`), inclusive nos fallbacks comuns de tiers, em streaming e em cadeia esgotada. A linha do principal usa `primaryRequestParams`, cada hop que falhou usa `FailedFallback.requestParams`, e só a linha do vencedor usa a re-derivação. Um pedido para um virtual não é `explicit_model_override`.
- O nome segue `validateVirtualModelName` de `thinker-shared` (1 a 64 caracteres, `auto` reservado) e é único por agente sem diferenciar maiúsculas: o serviço devolve 409, e o índice único `(agent_id, LOWER(name))` fica só na migração.
- A validação das rotas na escrita é **estrita**: uma rota que não resolve no catálogo do agente (`getModelsForAgent`, já filtrado pelos provedores habilitados) devolve 400, e um `keyLabel` enviado que não existe para o provedor também. Sem `keyLabel`, a rota é guardada sem rótulo; a chave padrão é escolhida na hora do pedido.
- A listagem calcula `shadows` (IDs reais que o nome sombreia) e `context_length` com um único snapshot do catálogo por requisição, sem `isRouteAvailable` rota a rota (`virtual-model-chain.ts`).
- A lista do agente fica em cache no `RoutingCacheService` (`getVirtualModels`) e cai junto com `invalidateAgent`, o que cobre as escritas no tier `default`.
- Apagar um virtual apaga as linhas de `agent_model_params` com `scope_key = 'virtual:<id>'` (`modelParamsScopeForVirtualModel`).
- **CLI e MCP** usam o mesmo `VirtualModelService`: `thinker routing virtual list|create|update|delete|enable|disable` e as ferramentas `thinker_routing_virtual_*` (`mcp/tools/virtual-models.tools.ts`). As duas acham o virtual pelo nome sem diferenciar maiúsculas, ou pelo `id`. `routing status`/`thinker_routing_status` listam os virtuais e acrescentam `routes_by_virtual_model` e `active_virtual_models`, a partir do campo `routable` da listagem (`virtualModelRoutable`: a mesma cadeia que o proxy monta, só com o slot `default` em `continue_on_default`, filtrada pelo snapshot do catálogo) (o `RoutingStatus` compartilhado com o dashboard continua falando só de `auto`; no MCP, `status_for: "auto"` e, quando só os virtuais roteiam, `reason: "auto_not_routable"` com a causa original em `auto_reason`), e `routing test`/`thinker_routing_test` aceitam o nome em `model` e devolvem `routing_reason` e `virtual_model` lidos dos cabeçalhos `X-Thinker-*`.
- **Parâmetros por nome:** `RouteModelParamsService` aceita como alvo um tier (string) ou `{ virtual: <nome> }`. São seletores separados, porque um tier e um virtual podem ter o mesmo nome (hoje o único tier endereçável é `default`). O REST é `GET|PATCH /api/v1/routing/:agentName/virtual-model-params?virtual=<nome>&model=<id>`, ao lado de `tiers/:tier/model-params`. O MCP usa o campo `virtual`, exclusivo com `tier`, e a CLI usa `--virtual`, exclusivo com `--tier`. Só a cadeia do próprio virtual é endereçável: as rotas emprestadas do Default usam os parâmetros do tier `default`. O endpoint por escopo (`PUT|DELETE /model-params` com `scope: "virtual:<id>"`) grava as mesmas linhas. O `model` casa em camadas, e a primeira com resultado vence: (1) o ID guardado, (2) o ID público da rota (`openAiModelId` do catálogo do agente, por exemplo `<alias>/<modelo>` de um custom provider), (3) o ID nativo, com ou sem o prefixo do provedor. Só há ambiguidade dentro da camada vencedora, e a mensagem sugere apenas nomes que selecionam uma única conexão; a resposta traz `public_model` e `public_models`.

**Fallback**: cada tier tem um modelo principal e até 5 de reserva (`routing/dto/routing.dto.ts`). Qualquer status HTTP >= 400 (`fallback-status-codes.ts`), timeout de tentativa (`PROVIDER_TIMEOUT_MS`), falta de primeiro trecho (`streamWarmupMsFor` em `stream-warmup.ts`: `tenant_providers.stream_warmup_ms` da conexão selecionada, que vem no cache de chaves sem consulta extra > `THINKER_LOCAL_STREAM_WARMUP_MS` para runners locais > `STREAM_WARMUP_MS`) ou silêncio em streaming (`STREAM_IDLE_TIMEOUT_MS`) leva à próxima rota (`proxy-fallback.service.ts`). Se todas falham, o cliente recebe o erro do provedor da última tentativa (não um código `M###`). Antes da próxima rota, um provedor custom com várias chaves (`custom:<uuid>` com mais de uma linha ativa em `tenant_providers`) tenta as outras chaves em ordem de prioridade quando a resposta é 401, 403 ou 429 (`tryForwardToProvider`); chaves em cooldown de 429 ou rejeitadas por 401 são puladas, a tentativa substituída é fechada como `superseded` e `ForwardResult.servedByKey` informa a conexão que atendeu, para o carimbo de `tenant_provider_id` e do rótulo.

**Roteamento ciente de context window** (#134, `routing/proxy/context-window-fit.ts`): antes da primeira tentativa, `ProxyService.fitChainToContext` estima os tokens do pedido (texto de `messages`/`system`/`input`/`instructions`, sem imagens e arquivos inline, mais as `tools` serializadas, a ~4 caracteres por token, somando `max_completion_tokens`/`max_tokens`/`max_output_tokens`) e tira da cadeia (principal e fallbacks) toda rota cuja janela conhecida no catálogo do agente (`DiscoveredModel.contextWindow`, lida com `snapshotRouteState`, a mesma regra do `context_length` de `/v1/models`) seja menor que a estimativa com folga: pula quando `estimativa > 0,95 × janela`. Janela desconhecida nunca pula; se nenhuma rota couber, a cadeia fica como estava. Pedidos com estimativa até 0,95 × 4096 nem consultam o catálogo. As rotas puladas saem em `X-Thinker-Context-Skipped` (IDs separados por vírgula) e o `routing_reason` não muda. Custom providers aceitam `context_window` por modelo (coluna "Context window" do formulário, guardado no JSON `models`). O piso `context_length` do `auto` em `/v1/models` continua sendo o menor da cadeia: é o tamanho que cabe em qualquer rota.

**SSRF**: URLs informadas pelo usuário (provedores customizados, URLs de assinatura) passam por `validatePublicUrl` e por `common/utils/ssrf-safe-fetch.ts` (DNS fixado, endereços de metadata de nuvem sempre recusados). LAN, loopback e `http://` são permitidos (recurso, não falha). Uma URL recusada falha a tentativa com HTTP 502 e `error.code: "provider_url_blocked"`, e o fallback continua. `HTTP_PROXY`/`HTTPS_PROXY` do processo são ignorados; o proxy de saída é o dos Servidores Proxy abaixo. Através de um proxy quem resolve o DNS do destino é o proxy: o Thinker ainda recusa nomes e IPs literais de metadata antes de enviar, e fixa o lookup do **host do proxy** (`ssrfSafeLookup`), mas o risco de rebinding do destino passa a depender do proxy escolhido pelo workspace.

**Servidores Proxy (proxy HTTP de saída)**: especificação em `tmp/PROXY-SPEC.md`. Todo `fetch` de saída passa por `outboundFetch` (`common/outbound/outbound-proxy.ts`); `ssrfSafeFetch` delega a ele com `pinDestination`. O escopo vem de um `AsyncLocalStorage` (`OutboundScope`) aberto por quem conhece o objeto vinculado: `ProxyEgressService.scopeForConnection` (em `resolveRouteCredentials`, inclusive a renovação OAuth, em `ProxyFallbackService.forwardWithKey` para cada chave, no Playground, na descoberta de modelos e no probe de custom provider existente), o interceptor `OutboundProviderScope('<provedor>')` nos controllers de OAuth (troca de código, device flow, revogação) e `scopeForTarget('trigger', ...)` no `TriggerWorkerService` (webhook, Telegram e e-mail; Syslog não é HTTP). Regras:
- **Cadeia** por objeto em `proxy_bindings` (`target_type` `provider` | `connection` | `trigger` | `email_config`, `position`, `proxy_id` nulo = "Direct"): primeiro item é proxy, até 5 de fallback, "Direct" no máximo uma vez a partir do 2º, sem repetir proxy. Proxy efetivo: cadeia da conexão > cadeia do provedor (`tenant_providers.provider`) > `THINKER_HTTP_PROXY` (exceto hosts de `THINKER_NO_PROXY`) > direto. "Direct" ignora o proxy global. Provedores locais nunca usam proxy.
- **Transporte**: pacote `undici` com `ProxyAgent` (CONNECT para todo destino, `proxyTunnel: true`), credenciais em `Proxy-Authorization: Basic`, `connect_timeout_ms` no connect e no CONNECT, agentes em cache LRU (256) por id + `updated_at`. O pool do proxy (`TunnelPool`) marca erros anteriores ao túnel como erro de proxy e mede `tunnel_ms`.
- **Failover** para o próximo item: conexão recusada/timeout/DNS do proxy, TLS com o proxy, 407, CONNECT não-2xx e **429 do provedor** (antes de qualquer byte ao cliente; se o último item também der 429, a resposta segue o fluxo normal de rotação). Demais respostas não trocam de proxy. Proxy desativado é pulado (`skipped_disabled`, sem log). Sem item que funcione: `ProviderProxyFailedError` → HTTP 502 `error.code: "provider_proxy_failed"` (marcador de gateway como o `provider_url_blocked`) e o roteamento segue para a próxima rota. Falha do proxy global também fecha (nunca sai direto).
- **Registro**: cada tentativa grava `agent_messages.egress` (`{kind: proxy|direct|global, proxy_id, name}`) e `egress_hops` (`[{proxy_id, name, position, result, ms, tunnel_ms, status, error}]`), expostos no detalhe da requisição; `trigger_event_logs` tem as mesmas colunas. Cada uso de proxy do workspace incrementa `proxy_usage_daily` (por dia, proxy, `source_type`, `source_id`: conexões, sucessos, falhas por código, soma/máximo do túnel, bytes, usos como fallback) e grava `proxy_logs` (só falhas; tudo com debug ligado, que expira em `debug_until` pelo cron `proxy-debug-expiry`; o botão Testar sempre registra).
- **API** (`proxy-servers/`, `@MinRole('admin', { includeReads: true })`): `GET|POST /api/v1/proxy-servers`, `GET|PATCH|DELETE /proxy-servers/:id` (com vínculos, `DELETE` devolve 409 com a lista; `?mode=remove` tira o proxy de todas as cadeias, removendo as que ficarem sem proxy, e `?mode=replace&replace_with=<id>` põe outro no lugar; o proxy sai na mesma transação), `POST /proxy-servers/:id/test` (`{url}`, GET por um túnel novo, mesmo desativado), `GET /proxy-servers/:id/logs`, `GET /proxy-servers/:id/stats`, `GET|PUT /api/v1/proxy-bindings/:targetType/:targetId` (`{chain: [id | "direct"]}`; `[]` volta a herdar). A senha é cifrada (`password_encrypted`, coberta pela re-cifragem) e nunca volta na API. O host do proxy aceita LAN, loopback e rede Docker, e recusa só metadata de nuvem (ao salvar e no connect).

**Provedores locais** (Ollama, LM Studio, llama.cpp): N servidores por tipo, cada um uma linha de `custom_providers` com `local_type` e `local_config` (`scheme`, `host`, `port`, `path_prefix`, `request_timeout_ms`, `probe_timeout_ms`). Tipos, padrões e validação ficam em `common/constants/local-servers.ts` (`LOCAL_SERVER_TYPE_DEFAULTS`, `defaultLocalServerConfig`, `invalidLocalServerConfigReason`, `localServerBaseUrl`); o `base_url` é sempre derivado (`scheme://host:porta/prefixo/v1`) e um `PUT` com `base_url` numa linha local devolve 400. O host vale as mesmas regras das URLs: sem credenciais, sem query ou fragmento, e depois `validatePublicUrl` e `ssrfSafeFetch` como qualquer custom provider. Modelos têm preço zero (`enrichCustomProviderModels` com `local`), a conexão é `auth_type 'local'` (custo 0 no gravador e no Playground; warm-up `THINKER_LOCAL_STREAM_WARMUP_MS`) e o proxy usa o `request_timeout_ms` do servidor (`ProviderEndpoint.timeoutMs`) e só manda `Authorization` com chave guardada. `canonicalizeAgentMessageKeys` não reescreve linhas locais: os logs ficam com `custom:<uuid>`, para distinguir servidores. O teste de conexão (`routing/custom-provider/local-server-probe.ts`, `POST custom-providers/probe` com `local_type`) usa a API de cada software: Ollama `/api/version`, `/api/tags`, `/api/ps` e `/api/show` (capacidades e `<arch>.context_length`, até 40 modelos); LM Studio `/api/v1/models`, depois `/api/v0/models` e `/v1/models`; llama.cpp `/health`, `/v1/models` (router: `status.value`) e `/props` (`n_ctx`, visão). `GET custom-providers/local-defaults` devolve os padrões de cada tipo, pré-preenchidos por `OLLAMA_HOST`, `THINKER_LMSTUDIO_BASE_URL` e `THINKER_LLAMACPP_BASE_URL`. Fontes dos padrões (out/2026): Ollama `docs/api.md` e `docs/faq.mdx` (127.0.0.1:11434); LM Studio `lmstudio.ai/docs/developer/rest` (1234, Bearer opcional); llama.cpp `tools/server/README.md` (127.0.0.1:9931 desde ggml-org/llama.cpp#30159; antes 8080). A migração `LocalServers1804500000000` marcou os custom providers criados pelos tiles antigos (pelo nome) e transformou a conexão Ollama embutida de cada tenant num servidor no `OLLAMA_HOST`, regravando `tenant_providers.provider` (mesmo id, então os harnesses continuam habilitados), as rotas de tiers, especificidades e modelos virtuais e `agent_model_params`. Os caminhos canônicos `ollama`/`lmstudio`/`llamacpp` do proxy continuam só para dados antigos. Dashboard: `components/LocalServerForm.tsx`, aberto pela página Local (`ProviderConnectionsPage`) e por deep link do tipo.

**Erros do Thinker (`M###`)**: o catálogo está em `common/errors/error-codes.ts` e a documentação para o usuário em [`docs/erros.md`](../erros.md). Levante-os com `ThinkerError`, nunca com `HttpException` pura. Todo código é gravado em uma requisição, exceto `M001`, `M002`, `M003`, `M005` e `M006`, que a guard de chave levanta antes de haver tenant (`UNRECORDABLE_THINKER_CODES`). Um código novo precisa de mapeamento em `THINKER_CODE_TO_REASON` ou de declaração como não gravável (`thinker-error.spec.ts` falha senão) e de uma seção em `docs/erros.md`.

## Gravações

Gravação do corpo das tentativas ao provedor, por harness (ligada em harnesses novos). Variáveis `THINKER_RECORDING_*`:

- `THINKER_RECORDING_STORAGE` (`auto|s3|filesystem|disabled`): em `auto`, credenciais S3 completas ganham; senão usa `THINKER_RECORDING_FILESYSTEM_PATH` (`/data/request-recordings` em produção).
- **Retenção de logs** em três níveis: harness (`agents.log_retention_days`, "Personalizada") > organização (`tenants.log_retention_days`, editável em Organização, `GET|PATCH /api/v1/organizations/:id/log-retention`) > `THINKER_RECORDING_RETENTION_DAYS`, padrão **30** (`config/recording-retention.ts`; valor que não seja inteiro positivo derruba o boot). `NULL` segue o nível de cima ("Global" no harness). O harness lê e grava a sua em `GET|PATCH /api/v1/routing/:agent/recording` (`retention_days`, `global_retention_days`) e na criação (`log_retention_days`).
- **Limpeza** diária às 02:00 (`database/request-recording-retention.service.ts`, trava advisory): apaga os corpos gravados e zera `request_headers`, `request_params` e `timeline` de `requests` e `agent_messages` expirados, em lotes de 5000. As linhas ficam (status, tokens, custo), então gráficos e totais não mudam. A mesma limpeza **apaga** as entregas de gatilho já terminadas (`trigger_events` em `delivered`/`failed`, com os `trigger_event_logs` em cascata) pela mesma retenção harness > organização > ambiente. Também apaga `proxy_logs` expirados pela retenção do proxy (`proxy_servers.log_retention_days`) > organização > ambiente; `proxy_usage_daily` nunca é apagado.
- Cifradas com a chave **atual**; a re-cifragem de `PREVIOUS` não as toca. Imagens base64 embutidas são removidas.
- Código: `common/services/request-recording-storage.service.ts`, `common/utils/request-recording-codec.ts` e `routing/proxy/attempt-recording*.ts`.

## Gatilhos de eventos

Configurados por workspace em `/triggers` (owner e admin; a lista é visível a todos). O harness escolhe na aba Triggers (`/harnesses/:nome/triggers`) quais gatilhos aciona, podendo adicionar vários de uma vez, e com quais eventos (`GET|PUT /api/v1/agents/:agent/triggers`). Código em `packages/backend/src/triggers/`; constantes compartilhadas (tipos, eventos, variáveis, templates padrão, limites) em `packages/shared/src/triggers.ts`.

- **Tipos:** `email` (Resend, Mailgun, SendGrid, que o dashboard mostra como três tipos: Email API Resend, Email API Mailgun e Email API SendGrid; sem destinatário vai para o owner do workspace), `webhook` (método, URL, cabeçalhos com valores cifrados, corpo, HMAC-SHA256 opcional em `X-Thinker-Signature`; sucesso é 2xx; a URL segue `THINKER_PROVIDER_PRIVATE_URLS` ao salvar e a entrega usa `ssrfSafeFetch`, que recusa metadados de nuvem), `telegram` (`sendMessage` com parse mode HTML, tópico opcional, envio silencioso) e `syslog` (RFC 5424 ou 3164, UDP ou TCP com uma mensagem por linha, facility e severidade por evento).
- **Eventos:** `limit.alert`, `limit.block`, `provider.failure` (todas as rotas falharam por erro do provedor ou de transporte; no máximo um a cada 5 min por harness e provedor, com `failure.count`), `credential.expired` (401/403 do provedor numa conexão, uma vez até ela voltar a responder; erros `M###` do Thinker não contam), `request.debug` (toda requisição, só metadados) e, assinados no próprio gatilho, `harness.created`/`harness.deleted`. A tela de teste (`/triggers/test?trigger=<id>&harness=<nome>`, aberta pelo ícone de teste na lista, no editor e na aba do harness) escolhe o gatilho, o evento e o harness, preenche as variáveis com valores de exemplo editáveis e entrega uma vez, na hora (`POST /triggers/:id/test` com `event_type` e `vars`; id, tipo e horário do evento, workspace, nome do gatilho e tentativa são sempre calculados pelo Thinker). O teste entrega mesmo com o gatilho desativado.
- **Templates:** `{{variavel}}`, sem lógica; variável desconhecida vira vazio. O valor é escapado pelo destino (JSON no corpo JSON do webhook, HTML no e-mail e no Telegram, URL na URL). `{{event.json}}` é o objeto com todas as variáveis. Lista em `TRIGGER_VARIABLES`.
- **Fluxo:** produtores só publicam sinais em `TriggerSignalService` (`common/services/`): o gravador do proxy (requisição terminal e cada tentativa), as regras de limite e a criação/remoção de harness. `TriggerListenerService` decide se há assinantes (cache de vínculos de 30 s) e grava em `trigger_events` com as variáveis congeladas; nada disso roda no caminho da requisição.
- **Entrega:** `TriggerWorkerService` varre a fila a cada 10 s (e logo após novos eventos) com `FOR UPDATE SKIP LOCKED`, então várias réplicas convivem. Toda falha é repetida até `max_retries` (0–10, padrão 3), com intervalo fixo `retry_delay_seconds` (1–3600, padrão 30) e `timeout_seconds` (1–60, padrão 10). Cada tentativa vira uma linha em `trigger_event_logs` com status HTTP, erro e resposta (até 4 KB, segredos removidos). Linha presa em `delivering` por 5 min volta para a fila. Acima de 1000 entregas pendentes num gatilho, eventos novos são descartados com aviso no log do servidor.
- **Segredos** (chave de API, token do bot, valores de cabeçalho, segredo HMAC) ficam juntos e cifrados em `triggers.secrets_encrypted`, coberto pela re-cifragem. A API devolve só dicas mascaradas; um campo ausente mantém o valor, `null` apaga.
- **Proxy de saída:** webhook, Telegram e e-mail têm a guia "Outbound proxy" (cadeia em `proxy_bindings` com `target_type 'trigger'`); cada tentativa grava `egress`/`egress_hops` em `trigger_event_logs`. Syslog não tem.
- **Migração** `1804400000000-AddEventTriggers`: cada `email_provider_configs` virou um gatilho de e-mail ligado aos harnesses com regras de limite (`limit.alert`, `limit.block`). A tabela antiga ficou sem uso. `EMAIL_PROVIDER`/`EMAIL_API_KEY` no ambiente servem só para e-mails de autenticação.

## Sem phone-home

O produto não faz chamadas de saída próprias: nada de telemetria, verificação de atualização, descoberta ou Sentry. Os Servidores Proxy e `THINKER_HTTP_PROXY` só mudam o caminho do tráfego que já existiria (não há health check periódico; o botão Testar só roda quando o usuário pede). O tráfego de saída vai só para os provedores e os destinos de gatilhos (e-mail, webhook, Telegram, Syslog) que o operador configurou, mais a exceção do [ADR 0003](../adr/0003-excecao-catalogos-publicos.md): `openrouter.ai` e `models.dev` (ligados por padrão) e o documento do OpenCode Go em `raw.githubusercontent.com` (só com um provedor OpenCode Go). `THINKER_CATALOG_SYNC=false` desliga os três; os dados embutidos viram o fallback, incluindo o snapshot de preços que `docker/pricing-snapshot.mjs` grava em `dist/pricing-snapshot.json` durante o build da imagem (#73; `--build-arg THINKER_PRICING_SNAPSHOT=false` pula). Também há a busca do documento CIMD de um cliente MCP durante o OAuth (só endereços públicos, salvo `THINKER_CIMD_ALLOW_PRIVATE=true`). Qualquer outro destino exige um novo ADR. Lista voltada ao usuário: [`privacidade.md`](../usuario/privacidade.md).

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
| `ci.yml` | PRs e pushes na `main` | Lint, typecheck (TypeScript 6 e, em job próprio, TypeScript 7 com `tsgo --noEmit`), build, testes unitários por pacote (o do backend também com `TZ=America/Sao_Paulo`), e2e com PostgreSQL 18 (`TZ=UTC` e `America/Sao_Paulo`), scripts |
| `docker.yml` | PRs que tocam a imagem | Build `linux/amd64` e `linux/arm64`, sem publicar |
| `docker-smoke.yml` | PRs que tocam imagem ou compose | Teste de fumaça do Compose (somente leitura) e `install.sh` ponta a ponta |
| `codeql.yml` | PRs, pushes, semanal | Análise de código |
| `dependency-review.yml` | PRs | Revisão de dependências |

Só os checks de `ci.yml` podem ser obrigatórios na `main`, porque os demais são filtrados por caminho.

## Releases

Só o pacote `thinker` (`packages/thinker/`) é versionado; ele guarda a versão canônica da imagem. Os demais pacotes são `private`.

Toda entrega sai por `scripts/ship.sh "<mensagem no formato Conventional Commits>" [patch|minor|major]` ([ADR 0005](../adr/0005-modo-autonomo.md)). O script:

1. faz commit do que estiver pendente;
2. sobe a versão de `packages/thinker` e escreve `docs/releases/X.Y.Z.md` a partir dos assuntos dos commits desde a última tag;
3. integra na `main` (push direto ou, se a proteção recusar, PR com squash imediato);
4. cria e envia a tag anotada `vX.Y.Z`.

**Publicação:** depois de enviar a tag, o `ship.sh` constrói amd64 e arm64 pelo Docker local, com a conta do Docker Hub em que ele está logado (`tmsoftbrasil`) e o builder local `desktop-linux`, publica o manifesto multi-arquitetura com as tags `X.Y.Z`, `X.Y`, `latest` e `sha-<curto>` e cria a release no GitHub com as notas. Não existe workflow de publicação na CI. Ninguém roda `docker login` nem manipula credenciais: o mantenedor mantém a sessão local logada. A CLI (`thinker-cli`) pode ser carimbada com `npm run set-version --workspace=packages/cli`.

### Colocar em produção

Colocar o serviço em produção envolve três passos, nesta ordem:

1. publicar no GitHub: integrar na `main` e criar a release marcada como latest (`ship.sh`);
2. publicar no Docker Hub a tag `tmsoftbrasil/thinker:latest` (`ship.sh`);
3. aplicar no servidor `api.tmsoft.com.br`: backup do banco, atualização do contêiner e verificação.

Os detalhes (acesso, comandos, verificação e como reverter) estão em `docs/dev/producao.local.md`. É um arquivo só local, ignorado pelo git (`*.local.md`), e não sai do computador do mantenedor.

O histórico até a 0.1.2 está em `packages/thinker/CHANGELOG.md` (gerado pelo Changesets, aposentado depois da 0.1.4). Daqui em diante, as notas ficam só em `docs/releases/`.

## Fluxo de trabalho: merge e agentes

O Thinker é desenvolvido por agentes do Claude Code. O **Principal** (guiado por `CLAUDE.md`) conversa com o mantenedor, planeja e delega aos subagentes de `.claude/agents/`; a tabela completa e o ciclo de vida de um agente novo estão em [`docs/agentes.md`](../agentes.md).

| Necessidade | Agente |
| --- | --- |
| O que mudou no upstream | `manifest-tracker` |
| Desenho de feature grande, ADR | `architect` |
| NestJS, TypeORM, auth, proxy | `backend-dev` |
| Dashboard React | `frontend-dev` |
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
