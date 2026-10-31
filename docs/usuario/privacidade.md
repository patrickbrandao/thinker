# Privacidade e saída de rede

O Thinker **não faz phone-home**: não envia telemetria, não verifica atualizações, não relata erros a terceiros e não consulta serviços de descoberta. O dashboard também não faz requisições a terceiros (os links externos só abrem quando você clica). O servidor só fala com os destinos abaixo.

Esta lista segue o [ADR 0003](../adr/0003-excecao-catalogos-publicos.md) e foi conferida contra o código do backend (`fetch` e URLs fixas em `packages/backend/src`). Não há outro destino de saída.

## Única exceção: catálogos públicos de modelos e preços

São GETs anônimos, sem nenhum dado da sua instância, que alimentam preços, janelas de contexto e capacidades dos modelos.

| Destino | Gatilho | Como desligar |
| --- | --- | --- |
| `openrouter.ai` (`/api/v1/models`) | No boot e uma vez por dia. Ligado por padrão. | `THINKER_CATALOG_SYNC=false` |
| `models.dev` (`/api.json`) | No boot e uma vez por dia. Ligado por padrão. | `THINKER_CATALOG_SYNC=false` |
| `raw.githubusercontent.com` (documento do OpenCode Go) | Só quando existe um provedor OpenCode Go cadastrado; cache de 1 hora. | `THINKER_CATALOG_SYNC=false` |

Com `THINKER_CATALOG_SYNC=false` as três buscas somem e os custos vêm do snapshot de preços embutido na imagem (OpenRouter e models.dev do dia do build, baixados só durante o build, nunca em execução); as requisições do OpenCode Go custam `$0`. Indicado para ambientes isolados da internet.

## Destinos que você configura

Estes só são contatados porque você os configurou, e só quando o recurso é usado.

| Destino | Gatilho |
| --- | --- |
| APIs de inferência e de listagem de modelos dos **provedores conectados**, incluindo Ollama Cloud (`ollama.com`) e os servidores locais cadastrados (Ollama, LM Studio, llama.cpp) | Requisições roteadas e descoberta de modelos. |
| URLs dos **provedores customizados**, inclusive em LAN | Idem. |
| **Fluxos OAuth e de assinatura** dos provedores que você conecta, como `auth.openai.com`, `claude.ai` e `console.anthropic.com`, `accounts.google.com`, `oauth2.googleapis.com` e `cloudcode-pa.googleapis.com`, `github.com` e `api.github.com` (Copilot), `auth.x.ai`, MiniMax e o AWS SSO (Kiro) | Ao conectar ou renovar a assinatura. |
| **E-mail de autenticação** (Resend, SendGrid, Mailgun) | Só se `EMAIL_PROVIDER` estiver definido. |
| **Gatilhos de eventos**: as APIs de e-mail (`api.resend.com`, `api.sendgrid.com`, `api.mailgun.net`), `api.telegram.org`, a URL de cada webhook e o servidor Syslog que você cadastrar | Só para os gatilhos cadastrados no workspace e ligados a um harness ou evento. |
| **Login social** (Google, GitHub, Discord) | Só se o par `*_CLIENT_ID`/`*_CLIENT_SECRET` estiver definido. |
| **Armazenamento S3** das gravações | Só se `THINKER_RECORDING_S3_ENDPOINT` estiver definido. |
| **Metadados de cliente MCP (CIMD)**: o documento na URL HTTPS que um cliente MCP informa como `client_id` durante o OAuth | Quando um cliente MCP faz login. Só endereços públicos, salvo `THINKER_CIMD_ALLOW_PRIVATE=true`; endereços de metadata de nuvem ficam sempre bloqueados. Desligue o MCP com `MCP_ENABLED=false`. |

## O que não existe

Telemetria, verificação de atualização, Sentry ou relatórios de erro, serviços hospedados do projeto de origem (inclusive a busca remota em `modelparams.dev`, removida) e análises externas. O Thinker não envia estatísticas de uso a ninguém.

## Seus dados

Chaves de provedores, tokens OAuth e gravações ficam no seu PostgreSQL e no seu volume (ou bucket S3), cifrados com `THINKER_ENCRYPTION_KEY`. As gravações contêm os prompts e as respostas completos e são apagadas após a retenção de logs (a do harness, senão a da organização, senão `THINKER_RECORDING_RETENTION_DAYS`, 30 por padrão), junto com os cabeçalhos e parâmetros capturados das requisições. Para não gravar nada, desligue a gravação no harness ou use `THINKER_RECORDING_STORAGE=disabled`.
