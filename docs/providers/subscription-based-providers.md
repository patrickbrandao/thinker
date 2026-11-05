# Provedores por assinatura

Reaproveite um plano pago que você já tem: ChatGPT Plus, Claude Max, GitHub Copilot, ModelArk Coding Plan, Command Code, Qwen Token Plan, Xiaomi MiMo Token Plan, Kimi Coding Plan, GLM Coding Plan, login com Google, MiniMax Coding Plan, Kiro, Grok, Ollama Cloud ou OpenCode Go.

Se você já paga por um dos planos abaixo, o Thinker pode rotear pela assinatura em vez de uma chave de API. A autenticação é OAuth no navegador, código de dispositivo ou token de assinatura, conforme o provedor.


> **Termos de uso.** Vários planos restringem o uso a ferramentas de código interativas e podem suspender a conta ou a chave quando o tráfego vem de automação ou de clientes de terceiros: Sign in with Google (Gemini CLI), Qwen Token Plan, Xiaomi MiMo Token Plan, GLM Coding Plan e Grok. O dashboard mostra o aviso de cada um ao conectar. No GLM Coding Plan, use a chave do plano: a chave Standard não consome a cota e cobra do saldo.
## Assinaturas suportadas

| Provedor | Plano | Autenticação | Catálogo de modelos |
| --- | --- | --- | --- |
| [OpenAI](https://openai.com) | ChatGPT Plus/Pro/Team | OAuth (navegador) | Lista fixa de modelos ChatGPT e Codex |
| [Anthropic](https://www.anthropic.com) | Claude Max / Pro | Setup token | `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4` |
| [GitHub Copilot](https://github.com/features/copilot) | Assinatura GitHub Copilot | Código de dispositivo | Lista fixa do Copilot |
| [BytePlus](https://www.byteplus.com/en/activity/codingplan) | ModelArk Coding Plan | Token de assinatura | Lista fixa do ModelArk Coding Plan |
| [Command Code](https://commandcode.ai/studio) | Assinatura Command Code | Token de assinatura | Catálogo dinâmico da API do provedor |
| [Qwen](https://home.qwencloud.com/api-keys) | Qwen Token Plan | Token de assinatura | Catálogo dinâmico do Token Plan |
| [Xiaomi MiMo](https://platform.xiaomimimo.com) | MiMo Token Plan | Token de assinatura | Lista fixa do MiMo Token Plan (`mimo-v2.6-pro`, `mimo-v2.6-flash`) |
| [Moonshot](https://www.kimi.com/code/console) | Kimi Coding Plan | Token de assinatura | Lista fixa do Kimi Coding Plan |
| [Z.ai](https://z.ai) | GLM Coding Plan | Token de assinatura | Lista fixa do GLM Coding Plan |
| [Google](https://ai.google.dev) | Login com Google | OAuth (navegador) | Lista fixa do Gemini CodeAssist |
| [MiniMax](https://www.minimax.io) | MiniMax Coding Plan | Código de dispositivo ou token | Lista fixa do MiniMax Coding Plan |
| [Kiro](https://app.kiro.dev) | Assinatura Kiro | Código de dispositivo | Lista fixa do Kiro |
| [xAI](https://x.ai) | Assinatura Grok | OAuth (navegador) | Catálogo dinâmico do proxy do Grok CLI |
| [Ollama Cloud](https://ollama.com) | Assinatura Ollama Cloud | Token de assinatura | Catálogo dinâmico de tags do Ollama Cloud |
| [OpenCode Go](https://opencode.ai) | OpenCode Go (beta) | Login no OpenCode Console (device code) ou chave de API | Catálogo dinâmico do OpenCode Go |

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

Cole uma chave de API do Command Code Studio. No Thinker, o Command Code é só por assinatura e exige um plano com acesso à API (qualquer um, menos o Go, que responde 403 `upgrade_required`). Os modelos são descobertos na API pública de provedor do Command Code.

### Qwen

Cole uma chave do Qwen Token Plan (prefixo `sk-sp-`). O Thinker descobre os modelos no endpoint do Token Plan e roteia requisições de chat completions e de estilo responses onde houver suporte.

**Limite:** o Thinker fala só com o Token Plan do Alibaba Model Studio em Singapura (`token-plan.ap-southeast-1.maas.aliyuncs.com`). As chaves do QwenCloud (`token-plan.maas.qwencloudapi.com`) e dos endpoints de Pequim e do 千问AI não são intercambiáveis com esse host e respondem 401/403. Use uma chave Token Plan criada no Model Studio internacional (Singapura).

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

OAuth no navegador para assinaturas Grok (SuperGrok ou X Premium+). O token da assinatura só é aceito pelo proxy do cliente oficial, `cli-chat-proxy.grok.com`, então o Thinker envia a inferência (Responses) e a descoberta de modelos para esse host com os cabeçalhos de identificação do Grok CLI. **Aviso:** isso apresenta o Thinker como o cliente oficial; a xAI não publica termos que autorizem gateways de terceiros, e a conta pode sofrer ação. Use por sua conta e risco. A API por chave (`xai-...`) segue em `api.x.ai`.

### Ollama Cloud

Cole uma chave de API do Ollama Cloud. Ele aceita formatos genéricos de chave; o Thinker não exige prefixo fixo. Os modelos são descobertos no catálogo de tags da nuvem.

### OpenCode Go

Clique em **Connect with OpenCode Go**: o Thinker abre a página do OpenCode Console com um código de dispositivo, o mesmo fluxo do `opencode auth login opencode`. Aprove o acesso na organização que tem o Go. O Thinker guarda o token de acesso e o refresh token e renova os dois antes de expirar (o refresh token é trocado a cada renovação). Se a sessão do Console for revogada, conecte de novo.

Ainda dá para colar uma chave de API do OpenCode (conta de serviço) no campo abaixo do botão. Os modelos, o protocolo de cada um e os preços vêm do catálogo público `https://opencode.ai/inference/go/v1/models`. Conforme o modelo, o Thinker roteia para `https://opencode.ai/inference/go/openai` (Chat Completions e Responses), `/inference/go/anthropic` (Messages) ou `/inference/go/google`. O custo gravado é o equivalente em dólar consumido da cota, a preço de lista.

Com o login do Console, a página do provedor mostra o uso da cota nas janelas de 5 horas, semana e mês. Uma requisição barrada pela cota (`GoUsageLimitError`) passa para o próximo modelo da cadeia, e a rota espera o horário de reset informado pelo OpenCode.

### OpenCode (por uso e modelos gratuitos)

O antigo "OpenCode Zen" agora se chama **OpenCode** (id `opencode`). Ele aceita três formas de conexão:

- **Chave de API** do OpenCode Console, cobrada por uso em créditos pré-pagos.
- **Login no OpenCode Console** (aba de assinatura, mesmo fluxo de device code do Go).
- **Sem chave**: o botão **Use free models (no key)** conecta só os modelos gratuitos do OpenCode, com o limite diário definido por ele (reinicia às 00:00 UTC). Alguns desses modelos podem usar os dados para treinamento.

Os modelos `opencode-zen/<modelo>` das configs antigas continuam funcionando, mas os novos IDs são `opencode/<modelo>`. Detalhes e riscos no [ADR 0009](../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md).

## Por que combinar assinaturas e chaves de API

Uma configuração comum é usar a assinatura como rota principal, pelo custo mensal previsível, e provedores com chave de API como fallback para limites do plano, quedas do provedor ou modelos que a assinatura não inclui. Fixe os modelos de assinatura nos tiers de roteamento e ponha os modelos de chave de API na lista de fallback. O Thinker faz a troca.
