# Organizações, papéis e contas

Desde a v0.3, cada instância do Thinker tem **organizações**. Agentes, provedores, roteamento, logs e custos pertencem a uma organização, e cada pessoa entra nela com um **papel**. A decisão está no [ADR 0006](../adr/0006-organizacoes-e-papeis.md).

## Papéis

| Ação | viewer | member | admin | owner |
|---|---|---|---|---|
| Ver painéis, custos e logs | sim | sim | sim | sim |
| Criar e editar agentes e chaves de agente, usar o playground | — | sim | sim | sim |
| Conectar provedores e credenciais, mexer no roteamento e nas notificações | — | — | sim | sim |
| Adicionar membros e criar contas na organização | — | — | sim (não mexe em owners) | sim |
| Renomear ou apagar a organização | — | — | — | sim |

Uma pessoa pode estar em várias organizações e troca entre elas pelo seletor no topo da barra lateral.

## Admin da instância

O primeiro usuário, criado no assistente `/setup`, é o **admin da instância**. Ao atualizar uma instalação antiga, o usuário mais antigo recebe esse papel e cada dono de tenant vira `owner` da sua organização. O admin da instância:

- cria organizações;
- vê e entra em qualquer organização, como `owner`;
- gerencia as contas em **Users** (`/admin/users`): cria, redefine senha e concede ou retira o papel de admin da instância.

## Criar contas

Não há cadastro aberto nem convite por e-mail. O admin da instância (em **Users**) ou um owner/admin da organização (em **Members & settings**) cria a conta com e-mail, nome e papel. O Thinker gera uma **senha temporária**, mostrada uma única vez. Passe-a para a pessoa por um canal seguro. No primeiro login ela precisa definir uma senha nova antes de usar o painel. Se a pessoa esquecer a senha, o admin da instância gera outra senha temporária em **Users**.

## URLs privadas e provedores locais

`THINKER_PROVIDER_PRIVATE_URLS` controla quem pode apontar provedores para a rede interna ou conectar Ollama, LM Studio e llama.cpp. Veja [Configuração](configuracao.md).
