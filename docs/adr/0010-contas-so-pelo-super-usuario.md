# ADR 0010 — Contas criadas só pelo super usuário

- **Status:** aceito
- **Data:** 2026-11-11
- **Altera:** [ADR 0006](0006-organizacoes-e-papeis.md), item 6, que deixava owner/admin de uma organização criar contas dentro dela

## Contexto

Pelo ADR 0006, adicionar um membro por e-mail na tela da organização criava a conta quando o e-mail não existia. Com isso, havia dois lugares para criar contas: **Usuários**, do admin da instância, e **Membros**, de cada organização. Na tela de membros também era possível trocar o papel de cada membro direto na lista.

## Decisão

1. Só o super usuário cria contas, na tela **Usuários**. "Super usuário" é o novo nome, na interface, do admin da instância. No código e na API ele continua sendo `isInstanceAdmin`.
2. `POST /organizations/:id/members` só adiciona uma conta que já existe. Para um e-mail sem conta, devolve 404 com `code: "account_not_found"` e não cria nada. A resposta mantém `temporaryPassword`, sempre `null`.
3. Na guia **Membros** só se adiciona uma conta existente ou se remove um membro. O papel é escolhido ao adicionar, e a lista não edita nada da conta.
4. Ao criar um super usuário com uma organização inicial, ele entra nela como `owner`. O papel é escolhido por quem cria só para contas comuns.

## Consequências

- Owner e admin de uma organização dependem do super usuário para criar uma conta nova.
- `PATCH /organizations/:id/members/:userId` (troca de papel) continua na API e no CLI, mas o painel não o usa mais.
