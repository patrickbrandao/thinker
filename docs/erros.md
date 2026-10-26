# Códigos de erro do Thinker

Toda falha gerada pelo próprio Thinker (e não pelo provedor) traz um código `M###` no texto, no formato `[🦚 Thinker M100] ... See <link>`. O link aponta para a seção correspondente desta página. O catálogo canônico fica em `packages/backend/src/common/errors/error-codes.ts`.

## M001

**Cabeçalho Authorization ausente.** Envie a chave como `Authorization: Bearer thk_<sua-chave>` ou `x-api-key: thk_<sua-chave>`.

## M002

**Token Bearer vazio.** Cole a chave do Thinker no cabeçalho.

## M003

**Formato de chave inválido.** Chaves do Thinker começam com `thk_`. Copie a sua no dashboard.

## M004

**Chave expirada.** Gere uma nova chave no dashboard.

## M005

**Chave não reconhecida.** Ela pode ter sido rotacionada ou apagada. Copie a chave atual no dashboard.

## M006

**Chaves conflitantes.** Os cabeçalhos `Authorization` e `x-api-key` trazem credenciais diferentes. Envie a chave em só um deles, ou a mesma nos dois.

## M100

**Chave de API do provedor ausente.** Cadastre a chave do provedor na página de roteamento do agente.

## M101

**Nenhum modelo para rotear.** Escolha um modelo padrão para o agente no dashboard.

## M102

**Credenciais de assinatura inutilizáveis.** O Thinker não conseguiu renovar o OAuth da assinatura. Reconecte o provedor no dashboard.

## M200

**Limite de uso excedido.** O agente atingiu um limite configurado. Ajuste-o na página de limites do agente.

## M201

**Limite de requisições por usuário excedido.** Aguarde alguns segundos e tente de novo.

## M202

**Limite de requisições por IP excedido.** Aguarde alguns segundos e tente de novo.

## M203

**Limite de concorrência excedido.** Há requisições simultâneas demais; aguarde um momento.

## M300

**Array `messages` ausente.** O corpo da requisição precisa do campo `messages`.

## M301

**Modelo virtual sem rota disponível.** O `model` pedido é um modelo virtual ativo do harness, mas nenhuma rota da cadeia dele está disponível agora: o provedor, o modelo ou a credencial de cada rota sumiu, ou nenhuma rota atende ao modo de resposta do virtual. Com "Continue on Default" ligado, o erro também aparece quando o tier Default não tem rota. O Thinker não cai para `auto` nem para outra regra. Corrija a cadeia, ou ligue "Continue on Default", na tela Routing do harness. O cabeçalho `X-Thinker-Virtual-Model` da resposta traz o nome do virtual.

## M302

**Modelo indisponível.** O modelo pedido não está disponível para este agente. Use `GET /v1/models` para listar os IDs disponíveis, ou habilite o provedor para o agente no dashboard.

## M500

**Erro interno.** Algo falhou no Thinker. Tente de novo em instantes; se persistir, veja os logs do servidor.
