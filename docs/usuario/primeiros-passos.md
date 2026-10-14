# Primeiros passos

Depois de [instalar](instalacao-docker.md), faltam quatro etapas para o primeiro chat roteado.

## 1. Criar o administrador

Abra `http://localhost:2099/setup` e informe o **token de setup** que está no log:

```bash
docker compose logs thinker | grep 'setup token'
```

Crie a conta de administrador (a senha precisa de pelo menos 8 caracteres). O token vale uma vez e deixa de funcionar assim que o primeiro administrador existe.

## 2. Conectar um provedor

No menu lateral, **Providers**:

- **Usage-based:** cole uma chave de API (OpenAI, Anthropic, Gemini e outros).
- **Subscriptions:** reaproveite um plano que você já paga. Veja [Provedores por assinatura](../providers/subscription-based-providers.md).
- **Local:** Ollama, LM Studio e llama.cpp. Veja [Provedores e roteamento](provedores-e-roteamento.md#modelos-locais).

O Thinker descobre os modelos disponíveis assim que a conexão é salva.

## 3. Criar um harness e copiar a chave `thk_`

O dashboard chama de **harness** cada agente ou aplicação que usa o gateway (na API e no código, `agent`). Crie um em **Harnesses**, escolhendo a plataforma (Claude Code, Codex, OpenCode, OpenClaw, Hermes, SDK e outras). Cada harness tem a sua chave, que começa com `thk_`, mostrada na criação e em **Settings** do harness.

Na página de roteamento do harness, configure ao menos o tier `default` (veja [Provedores e roteamento](provedores-e-roteamento.md#tiers-e-o-modelo-auto)). Sem isso, `"model": "auto"` responde `M101`.

## 4. Testar

```bash
curl -X POST http://localhost:2099/v1/chat/completions \
  -H "Authorization: Bearer thk_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Olá"}]}'
```

A resposta chega pelo modelo que o roteamento escolheu, e a requisição aparece no log do harness com custo, tokens e corpo (se a gravação estiver ligada).

Erros do próprio Thinker trazem um código `M###`; veja [Solução de problemas](solucao-de-problemas.md) e [Códigos de erro](../erros.md).

## Próximos passos

- Conectar seu agente: [Conectar harnesses](conectar-harnesses.md).
- Automatizar pelo terminal: [CLI `thinker`](cli.md).
- Ajustar variáveis: [Configuração](configuracao.md).
