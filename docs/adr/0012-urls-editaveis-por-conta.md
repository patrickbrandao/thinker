# ADR 0012 — Todas as URLs de um provedor editáveis por conta

- **Status:** aceito
- **Data:** 2026-11-15
- **Altera:** a regra de `routing/account-base-url.ts` de que só contas por chave de API têm URL editável e que assinaturas mantêm hosts fixos "para um token nunca ir para outro lugar"

## Contexto

Só a URL base de inferência de uma conta por chave de API podia ser trocada (`tenant_providers.base_url`). As demais URLs que um provedor usa ficavam fixas no código: listagem de modelos, as variantes de formato (Responses, Anthropic, Google), os hosts do Bedrock, e, nas assinaturas, as URLs de OAuth (autorizar, token, refresh, revogar), device code, troca de token, usuário, uso e inferência. Isso impedia apontar uma conta para um proxy, um espelho ou um simulador (a [simulação pura](../dev/simulacao-pura.md) com o White Wizard) sem mudar código, e a própria URL base tinha defeitos: desligava a escolha de formato por modelo e cortava o `/v1` de bases que o incluem.

## Decisão

1. **Toda URL que uma conta usa é editável na conta**, ao adicionar e ao editar, para contas por chave de API e por assinatura. Cada URL é um *slot* com id, finalidade, valor padrão (o de hoje, inclusive o que depende de região) e o tipo de credencial que recebe. O catálogo de slots por provedor fica em `packages/shared/src/provider-urls.ts`. Sem valor, vale o padrão; o comportamento de quem não mexe não muda.
2. **Os catálogos públicos continuam globais** (ADR 0003 e 0009: models.dev, openrouter.ai, `models.opencode.ai`), governados por `THINKER_CATALOG_SYNC`. Uma conta pode ter sua própria URL de listagem de modelos; quando tem, a listagem daquela conta vem dela.
3. **Salvaguardas para URLs que recebem credenciais:**
   - Nas assinaturas, só owner da organização ou super usuário editam URLs (as de chave de API seguem a regra atual de quem conecta provedores).
   - Toda requisição a uma URL alterada usa `ssrfSafeFetch` com revalidação e `redirect: 'error'`, inclusive os POSTs de token, refresh e revogação (um 307/308 reenviaria o refresh token).
   - URL de destino privado segue `THINKER_PROVIDER_PRIVATE_URLS`; endereços de metadata de nuvem são sempre recusados.
   - Mudar URLs de uma conta gera um alerta de auditoria com quem mudou, a conta e os slots (sem valores de credencial).
   - A guia de URLs avisa, nos slots que recebem token ou refresh token, que a credencial da conta será enviada para aquele host.
4. **Nas telas de adicionar e editar conta, as URLs ficam numa guia própria, "URLs"**, separada dos campos obrigatórios, para quem quer adicionar rápido não precisar olhar valores que já têm padrão seguro.

## Consequências

- Um owner pode, por engano ou por má-fé, mandar o token de uma assinatura para outro host. Fica registrado no alerta de auditoria e a tela avisa antes de salvar.
- Mudar o host quebra a identidade de cliente que algumas assinaturas exigem (Codex, Copilot, Claude Code, OpenCode); isso é responsabilidade de quem aponta para outro host.
- O código de resolução de URL passa a ter um ponto único, o que também corrige os defeitos da URL base antiga.
