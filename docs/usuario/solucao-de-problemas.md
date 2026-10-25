# Solução de problemas

Erros gerados pelo próprio Thinker (e não pelo provedor) aparecem como `[🦚 Thinker M### ...]` e o link aponta para [Códigos de erro](../erros.md). Esta página cobre os casos mais comuns e problemas que não têm código.

## Códigos de erro mais comuns

| Código | O que houve | O que fazer |
| --- | --- | --- |
| `M001`, `M002`, `M003` | Cabeçalho `Authorization` ausente, token vazio ou formato inválido. | Envie `Authorization: Bearer thk_...` ou `x-api-key: thk_...`. A chave do harness começa com `thk_`. |
| `M004`, `M005` | Chave expirada, rotacionada ou apagada. | Copie a chave atual nas configurações do harness. |
| `M006` | `Authorization` e `x-api-key` com valores diferentes. | Defina só uma credencial no cliente. No Claude Code e nos SDKs da Anthropic: `ANTHROPIC_API_KEY` **ou** `ANTHROPIC_AUTH_TOKEN`. |
| `M100` | Falta a chave do provedor. | Conecte o provedor em **Providers** e habilite-o para o harness. |
| `M101` | Nenhum modelo para rotear. | Configure um modelo no tier `default` do harness. A mensagem diz qual tier foi consultado. |
| `M102` | A assinatura não pôde ser renovada. | Reconecte o provedor de assinatura. |
| `M200` | Limite de uso do harness excedido. | Ajuste o limite na página de limites. |
| `M201`, `M202`, `M203` | Limite de requisições por tenant, por IP ou de concorrência. | Aguarde; ajuste `THINKER_RATE_MAX_REQUESTS`, `THINKER_IP_RATE_MAX_REQUESTS` ou `THINKER_CONCURRENCY_MAX`. |
| `M300` | Falta `messages` no corpo. | Envie o campo `messages`. |
| `M302` | O modelo pedido não está disponível para o harness. | Use um ID de `GET /v1/models` ou habilite o provedor. |
| `M500` | Erro interno. | Veja `docker compose logs thinker`. |

Quando todos os modelos do tier falham, o cliente recebe o erro do provedor da última tentativa, sem código `M###`. Consulte o log de requisições do harness para ver cada tentativa.

## Instalação e boot

**O container não inicia e o log fala de `THINKER_ENCRYPTION_KEY`.** A variável é obrigatória, precisa de 32 caracteres ou mais e ser diferente de `BETTER_AUTH_SECRET`. Se você atualiza uma instalação que dependia do antigo fallback para `BETTER_AUTH_SECRET`, siga a [rotação da chave](instalacao-docker.md#rotação-da-chave-de-cifragem). `THINKER_ENCRYPTION_KEY_PREVIOUS` também precisa ter 32 caracteres ou mais; remova-a se não há rotação em curso.

**O servidor recusa iniciar por causa de `MANIFEST_ENCRYPTION_KEY`.** Ela foi renomeada para `THINKER_ENCRYPTION_KEY`, com o mesmo valor. Veja as [notas da 0.1.0](../releases/0.1.0.md).

**O boot falha com `THINKER_RECORDING_RETENTION_DAYS must be a positive integer`.** O valor precisa ser um inteiro positivo. Apague a variável para usar os 30 dias padrão.

**"Invalid origin" ao entrar.** `BETTER_AUTH_URL` não é igual à URL do navegador (host e porta). Corrija no `.env` e rode `docker compose up -d`.

**Não acho o token de setup.** `docker compose logs thinker | grep 'setup token'`. Se o container reiniciou, procure a linha mais recente: cada boot sem usuários imprime um token novo. Com várias réplicas, use o log da réplica que vai receber o setup. Se `THINKER_SETUP_TOKEN` estiver definido, o token é o valor dessa variável e não aparece no log. Copiando de um visualizador que mostra as cores cruas (Portainer, por exemplo), não leve o `[39m` do fim da linha.

**Quero criar mais contas e o cadastro está fechado (`SIGNUP_DISABLED`, HTTP 403).** O cadastro público é fechado de propósito. Use `THINKER_ALLOW_SIGNUP=true` temporariamente.

**Chamadas MCP respondem `401 no token payload`.** `BETTER_AUTH_URL` não é alcançável de dentro do container. Veja [Instalação](instalacao-docker.md#porta-e-acesso-pela-rede).

## Provedores

**`provider_url_blocked` (HTTP 502).** A URL do provedor customizado aponta para um endereço de metadata de nuvem ou resolve para um. Use o endereço real do servidor; LAN, loopback e `http://` são aceitos.

**Modelo local não aparece.** O servidor precisa escutar em `0.0.0.0` (não `127.0.0.1`) e responder em `host.docker.internal:<porta>`. Veja [Modelos locais](provedores-e-roteamento.md#modelos-locais).

**Custos aparecem como `$0`.** Com `THINKER_CATALOG_SYNC=false` os preços vêm só dos dados embutidos, que cobrem poucos modelos. Religue a sincronização ou aceite os custos zerados. Veja [Privacidade](privacidade.md).

**Gravações antigas indisponíveis.** A chave de cifragem mudou: as gravações feitas com a chave antiga não são regravadas e ficam ilegíveis até a retenção apagá-las.

## Ainda sem resposta

Abra uma issue em [patrickbrandao/thinker](https://github.com/patrickbrandao/thinker/issues) com o código de erro, a versão da imagem e o trecho relevante de `docker compose logs thinker` (sem segredos).
