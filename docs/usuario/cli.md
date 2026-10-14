# CLI `thinker`

A CLI gerencia um gateway Thinker pelo terminal: cria harnesses (agentes), conecta provedores, configura o roteamento e consulta requisições. Ela só conversa com a instância que você indicar (por padrão `http://localhost:2099`) e nunca com um serviço hospedado.

O pacote é `thinker-cli` e instala o comando `thinker`. Requer Node.js 20 ou mais novo. Não é publicado em registro npm; instale a partir de um checkout do repositório:

```bash
npm ci
npm run build --workspace=packages/shared
npm run build --workspace=packages/cli
npm install -g ./packages/cli
thinker --help
```

Início rápido:

```bash
thinker login                      # abre o navegador (login com PKCE)
thinker agent create --name meu-app --platform openai-sdk
thinker provider connect openai --agent meu-app --credential-env OPENAI_API_KEY
thinker routing status meu-app
thinker agent setup meu-app        # instruções de conexão, com a chave mascarada
```

Para um gateway em outro host: `thinker login --url https://gateway.exemplo.com`. Para scripts: `printf '%s' "$CHAVE" | thinker login --token-stdin` ou `thinker login --token-env VARIAVEL`.

A CLI guarda o login em `~/.config/thinker/` e lê `THINKER_URL`, `THINKER_API_KEY`, `THINKER_AGENT_KEY` e `THINKER_AGENT_URL`. Referência completa de comandos e credenciais: [`packages/cli/README.md`](../../packages/cli/README.md).
