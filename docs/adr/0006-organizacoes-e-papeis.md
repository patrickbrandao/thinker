# ADR 0006 — Organizações, papéis e contas

- **Status:** aceito
- **Data:** 2026-10-27
- **Issues:** milestone v0.3 (#78, #102, #131); decisões em `docs/decisoes-iniciais.md` §2

## Contexto

Herdado do upstream, cada usuário do Better Auth tem no máximo um tenant (`tenants.owner_user_id`, índice único parcial). Todo recurso (agentes, provedores, roteamento, mensagens, notificações) é escopado por `tenant_id`, e a resolução usuário → tenant acontece num lugar só: `TenantCacheService.resolve()`, chamado pelo `SessionGuard`. As chaves de CLI (`api_keys`) já carregam o `tenant_id` direto. Não existe conceito de admin da instância: o primeiro usuário é criado pelo assistente `/setup` e o cadastro fica fechado (`THINKER_ALLOW_SIGNUP`).

A v0.3 precisa de organizações com membros e papéis, gestão de contas pelo admin, e de regras para quem pode apontar o gateway para a rede interna (#78) ou para os runners locais do host (#102).

## Decisão

1. **Organização = tenant.** A tabela `tenants` continua sendo a unidade de escopo; nenhuma consulta escopada muda. O nome visível é `tenants.organization_name` (o `name` interno continua único). `owner_user_id` fica como legado e deixa de ser lido na resolução.
2. **Membros:** tabela `organization_members (tenant_id, user_id, role, created_at)`, chave `(tenant_id, user_id)`. Um usuário pode estar em várias organizações. Papéis: `owner`, `admin`, `member`, `viewer`.
3. **Perfil do usuário:** tabela `user_profiles (user_id PK, is_instance_admin, must_change_password, active_tenant_id)`. A migração marca como admin da instância o usuário mais antigo e cria um membro `owner` para cada `owner_user_id` existente.
4. **Organização ativa:** o `SessionGuard` resolve `(tenantId, role)` a partir do cabeçalho `X-Thinker-Organization` (enviado pelo dashboard), senão `user_profiles.active_tenant_id`, senão a primeira associação. Pedir uma organização da qual o usuário não é membro devolve 403, exceto para o admin da instância, que entra em qualquer organização como `owner`. `TenantContext` ganha `role` e `isInstanceAdmin`. Uma chave de CLI herda o papel atual do usuário que a criou naquela organização; sem associação, a chave é recusada.
5. **Permissões** (um `RolesGuard` global lê o `TenantContext`):

   | Ação | viewer | member | admin | owner |
   |---|---|---|---|---|
   | Ler dashboards, analytics, logs | sim | sim | sim | sim |
   | Criar/editar agentes e chaves de agente, playground | — | sim | sim | sim |
   | Provedores, credenciais, roteamento, notificações | — | — | sim | sim |
   | Gerenciar membros e criar contas na organização | — | — | sim (não toca owners) | sim |
   | Apagar ou renomear a organização | — | — | — | sim |

   Por padrão, todo método que não é `GET`/`HEAD` exige `member`; os controllers de provedores, credenciais, roteamento e notificações exigem `admin` (`@MinRole('admin')`); os endpoints de instância exigem `isInstanceAdmin`. O MCP e a CLI passam pelos mesmos controllers e serviços.
6. **Contas:** sem cadastro aberto e sem convites. O admin da instância cria contas e organizações; owner/admin de uma organização cria contas dentro dela. A conta nasce com uma senha temporária gerada pelo servidor, mostrada uma única vez, e `must_change_password=true`: até a troca, só `GET /api/v1/me`, a troca de senha e o logout respondem (os demais devolvem 403 com `code: "password_change_required"`). O admin da instância pode redefinir a senha de qualquer conta (gera outra senha temporária).
7. **URLs privadas e runners locais (#78, #102):** `THINKER_PROVIDER_PRIVATE_URLS=allow|admin-only|deny`, padrão `admin-only`. Com `admin-only`, só o admin da instância e o owner da organização cadastram provedor custom com URL privada/LAN ou conectam Ollama, LM Studio e llama.cpp; os demais recebem 400 na URL privada e 403 (`private_destination_forbidden`) no runner local. Provedores já cadastrados continuam funcionando. Com `deny`, ninguém. A proteção contra metadados de nuvem continua valendo em qualquer modo.

## Consequências

- Nenhuma consulta de recurso muda: o escopo continua `tenant_id`, e a troca é só na resolução e na autorização.
- O dashboard ganha seletor de organização, páginas de membros e de contas (admin da instância) e a tela de troca de senha obrigatória.
- Instalações existentes migram sem perda: cada dono vira `owner` da sua organização, e o usuário mais antigo vira admin da instância.
- Orçamentos por organização e membro ficam para a v0.4 e se apoiam em `organization_members`.
