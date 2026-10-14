# Provedores por assinatura

Reaproveite um plano pago que você já tem: ChatGPT Plus, Claude Max, GitHub Copilot, ModelArk Coding Plan, Command Code, Qwen Token Plan, Xiaomi MiMo Token Plan, Kimi Coding Plan, GLM Coding Plan, login com Google, MiniMax Coding Plan, Kiro, Grok, Ollama Cloud ou OpenCode Go.

Se você já paga por um dos planos abaixo, o Thinker pode rotear pela assinatura em vez de uma chave de API. A autenticação é OAuth no navegador, código de dispositivo ou token de assinatura, conforme o provedor.

## Assinaturas suportadas

| Provedor | Plano | Autenticação | Catálogo de modelos |
| --- | --- | --- | --- |
| [OpenAI](https://openai.com) | ChatGPT Plus/Pro/Team | OAuth (navegador) | Lista fixa de modelos ChatGPT e Codex |
| [Anthropic](https://www.anthropic.com) | Claude Max / Pro | Setup token | `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4` |
| [GitHub Copilot](https://github.com/features/copilot) | Assinatura GitHub Copilot | Código de dispositivo | Lista fixa do Copilot |
| [BytePlus](https://www.byteplus.com/en/activity/codingplan) | ModelArk Coding Plan | Token de assinatura | Lista fixa do ModelArk Coding Plan |
| [Command Code](https://commandcode.ai/studio) | Assinatura Command Code | Token de assinatura | Catálogo dinâmico da API do provedor |
| [Qwen](https://home.qwencloud.com/api-keys) | Qwen Token Plan | Token de assinatura | Catálogo dinâmico do Token Plan |
| [Xiaomi MiMo](https://platform.xiaomimimo.com) | MiMo Token Plan | Token de assinatura | Lista fixa do MiMo Token Plan |
| [Moonshot](https://www.kimi.com/code/console) | Kimi Coding Plan | Token de assinatura | Lista fixa do Kimi Coding Plan |
| [Z.ai](https://z.ai) | GLM Coding Plan | Token de assinatura | Lista fixa do GLM Coding Plan |
| [Google](https://ai.google.dev) | Login com Google | OAuth (navegador) | Lista fixa do Gemini CodeAssist |
| [MiniMax](https://www.minimax.io) | MiniMax Coding Plan | Código de dispositivo ou token | Lista fixa do MiniMax Coding Plan |
| [Kiro](https://app.kiro.dev) | Assinatura Kiro | Código de dispositivo | Lista fixa do Kiro |
| [xAI](https://x.ai) | Assinatura Grok | OAuth (navegador) | Catálogo dinâmico da xAI |
| [Ollama Cloud](https://ollama.com) | Assinatura Ollama Cloud | Token de assinatura | Catálogo dinâmico de tags do Ollama Cloud |
| [OpenCode Go](https://opencode.ai) | OpenCode Go (beta) | Token de assinatura | Catálogo dinâmico do OpenCode Go |

## Conectar uma assinatura

1. Abra a página de roteamento no dashboard.
2. Clique no bloco do provedor.
3. Escolha a aba Subscription.
4. Conclua o fluxo de autenticação do provedor.

Provedores que aceitam chave de API e assinatura mostram as duas abas; os que só têm assinatura mostram apenas esse fluxo. Nos seletores de roteamento, as linhas de assinatura só aparecem depois que uma credencial de assinatura utilizável é salva (`has_api_key=true`).

## Como a autenticação funciona em cada provedor

### OpenAI

OAuth no navegador para contas ChatGPT Plus, Pro e Team. Depois de aprovado, as requisições passam pelo backend ChatGPT Codex, e não pela API pública da OpenAI. Os tokens são renovados automaticamente.

### Anthropic

Rode `claude setup-token` e cole o token `sk-ant-oat` no Thinker. As requisições levam os cabeçalhos de autenticação de assinatura da Anthropic. O modo assinatura não suporta cache de prompt nem batching.

### GitHub Copilot

Fluxo de código de dispositivo do GitHub: o Thinker mostra um código curto, você abre `https://github.com/login/device`, cola o código e aprova. As requisições vão ao endpoint de chat ou responses do Copilot com um token de curta duração que o Thinker renova.

### BytePlus

Cole uma chave de API do ModelArk Coding Plan, do console da BytePlus. O Thinker roteia as requisições compatíveis com OpenAI e com Anthropic do coding plan pelos endpoints ModelArk.

### Command Code

Cole uma chave de API do Command Code Studio. No Thinker, o Command Code é só por assinatura e exige o plano Pro ou superior. Os modelos são descobertos na API pública de provedor do Command Code.

### Qwen

Cole uma chave do Qwen Token Plan (prefixo `sk-sp-`). O Thinker descobre os modelos no endpoint do Token Plan e roteia requisições de chat completions e de estilo responses onde houver suporte.

### Xiaomi MiMo

Cole uma chave do MiMo Token Plan (prefixo `tp-`). O Thinker roteia pelo endpoint compatível com OpenAI do Token Plan e deixa o operador escolher o host da China, de Singapura ou da Europa.

### Moonshot

Cole uma chave do Kimi Code, do console do Kimi Code. As requisições vão ao endpoint compatível com Anthropic do Kimi Code, com o catálogo fixo `k3`, `k3-256k`, `kimi-for-coding` e `kimi-for-coding-highspeed`.

### Z.ai

Cole um token do GLM Coding Plan da Z.ai. O Thinker roteia para o endpoint de coding plan da Z.ai; o operador pode escolher o endpoint global ou o da China continental quando ambos existem.

### Google

OAuth no navegador para o fluxo CodeAssist do Google. A rota de assinatura usa uma lista fixa de modelos Gemini CodeAssist, e não o catálogo da API pública do Gemini.

### MiniMax

O Thinker suporta o fluxo de código de dispositivo do MiniMax Coding Plan. Quem tem um token do Coding Plan também pode colar o token direto, quando a interface oferece a alternativa.

### Kiro

Fluxo de código de dispositivo do Kiro. A assinatura expõe `kiro/auto` e rotas selecionadas de Claude, DeepSeek, MiniMax, GLM e Qwen numa só assinatura.

### xAI

OAuth no navegador para assinaturas Grok; a lista de modelos vem do endpoint de modelos compatível com OpenAI da xAI.

### Ollama Cloud

Cole uma chave de API do Ollama Cloud. Ele aceita formatos genéricos de chave; o Thinker não exige prefixo fixo. Os modelos são descobertos no catálogo de tags da nuvem.

### OpenCode Go

Entre no OpenCode Go, copie a chave de API e cole no Thinker. A descoberta de modelos é dinâmica e, conforme o modelo, o Thinker roteia por formato compatível com OpenAI ou com Anthropic.

## Por que combinar assinaturas e chaves de API

Uma configuração comum é usar a assinatura como rota principal, pelo custo mensal previsível, e provedores com chave de API como fallback para limites do plano, quedas do provedor ou modelos que a assinatura não inclui. Fixe os modelos de assinatura nos tiers de roteamento e ponha os modelos de chave de API na lista de fallback. O Thinker faz a troca.
