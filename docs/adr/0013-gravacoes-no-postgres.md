# ADR 0013 — Gravações no PostgreSQL como padrão

- **Status:** aceito
- **Data:** 2026-11-18
- **Altera:** a escolha automática do armazenamento das gravações (S3 quando configurado, senão disco) e a regra de que as gravações ficam cifradas com `THINKER_ENCRYPTION_KEY`

## Contexto

A gravação de cada tentativa ao provedor (corpo enviado, resposta completa ou stream bruto, formato) ia para um objeto gzip + AES-256-GCM em S3 ou num diretório (`/data/request-recordings`, o volume `thinker_request_recordings` no Docker). Ficava fora do dump do banco, não podia ser consultada por SQL e exigia um volume ou um bucket a mais. O levantamento de como Manifest, LiteLLM Proxy e OmniRoute guardam requisições está em [`docs/referencia/`](../referencia/) e em [`upstream/armazenamento-requisicoes.md`](../../upstream/armazenamento-requisicoes.md).

## Decisão

1. **Três backends**, escolhidos por `THINKER_RECORDING_STORAGE`: `postgres`, `filesystem` e `s3` (mais `disabled`). **`auto` passa a ser `postgres`**, mesmo com variáveis de S3 definidas; disco e S3 só valem quando escolhidos pelo nome.
2. No PostgreSQL, a gravação fica na tabela `provider_attempt_recordings`, uma linha por tentativa, com a mesma chave que `agent_messages.recording_key` já usa, o dono (`tenant_id`, `request_id`, `attempt_id`) e o conteúdo em **`jsonb` legível**, consultável por SQL. **Não é cifrada.** Disco e S3 continuam cifrados como antes.
3. **As gravações existentes são migradas.** No boot, com `postgres` ativo, um job em segundo plano (trava advisory, um réplica por vez) copia para a tabela cada gravação que ainda está no armazenamento antigo, o que o `auto` antigo escolheria (S3 se houver variável de S3, senão o diretório, se ele existir), e apaga o arquivo ou objeto. Até ser migrada, a gravação continua sendo lida do armazenamento antigo; uma que não puder ser movida fica lá e é tentada de novo no próximo boot.
4. A retenção não muda: a limpeza diária apaga a linha da tabela (e o objeto antigo, se ainda existir).

## Consequências

- Prompts e respostas completos ficam em texto claro no banco: quem tem acesso ao PostgreSQL ou a um dump lê tudo. A proteção passa a ser a do banco e dos backups.
- O banco cresce com o volume de gravações (o equivalente descomprimido do que ia para o disco) e os dumps também. A retenção (30 dias por padrão) limita o tamanho.
- O volume `thinker_request_recordings` continua montado só para a migração das gravações antigas; depois dela fica vazio.
- Strings com o caractere NUL ou com surrogates UTF-16 soltos, que o `jsonb` recusa, são gravadas sem o NUL e com U+FFFD no lugar do surrogate.
- Templates de deploy que já fixam `THINKER_RECORDING_STORAGE=s3` ou `filesystem` continuam no backend escolhido, sem migração.
