# ADR 0003 — Exceção para catálogos públicos de modelos e preços

- **Status:** aceito
- **Data:** 2026-10-10
- **Issue:** #11 (opção A)

## Contexto

A regra "sem phone-home" do [`CLAUDE.md`](../../CLAUDE.md) diz que o produto não faz chamadas de saída próprias: o tráfego de saída vai só para os provedores que o operador configurou. O backend herdado, porém, faz quatro buscas que não dependem de configuração:

| Serviço | Destino | Quando |
|---|---|---|
| `PricingSyncService` (`database/pricing-sync.service.ts`) | `GET https://openrouter.ai/api/v1/models` | boot e todo dia às 03:00 |
| `ModelsDevSyncService` (`database/models-dev-sync.service.ts`) | `GET https://models.dev/api.json` | boot e todo dia às 04:00 |
| `ProviderParamSpecService` (`routing/routing-core/provider-param-spec.service.ts`) | `GET https://modelparams.dev/api/v1/models.json` | boot e de hora em hora |
| `OpencodeGoCatalogService` (`model-discovery/opencode-go-catalog.service.ts`) | `GET https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/go.mdx` | boot, mesmo sem provedor OpenCode Go, e depois sob demanda (cache de 1 h) |

São GETs anônimos, sem dados da instância. Eles alimentam preços, capacidades e parâmetros por modelo, ou seja, o custo nas análises e a validação de parâmetros. Mesmo assim, expõem o IP da instância e falham em ambientes sem saída para a internet. O `modelparams.dev` é um serviço da Manifest, então buscá-lo é phone-home para o upstream.

## Decisão

1. **`modelparams.dev` sai.** A busca remota é removida em #17. O serviço passa a usar só o snapshot embutido do pacote `modelparams`, atualizado junto com as dependências.
2. **OpenRouter e models.dev continuam ligados por padrão.** São a única exceção documentada à regra "sem phone-home". A variável `THINKER_CATALOG_SYNC=false` desliga as duas buscas, no boot e nos crons. Com a busca desligada ou falhando, o Thinker usa os dados embutidos na imagem (hoje `model-discovery/known-model-prices.ts` e `known-model-modalities.ts`).
3. **O documento do OpenCode Go só é buscado se existir um provedor OpenCode Go cadastrado.** Sem esse provedor, o aquecimento no boot não roda e a instância não fala com `raw.githubusercontent.com`. `THINKER_CATALOG_SYNC=false` também desliga essa busca. Nesse caso, o custo por requisição do OpenCode Go cai para $0 (como hoje em caso de falha) e o formato da API vem da heurística por família de modelo que já existe em `provider-client.ts`.
4. **A regra do `CLAUDE.md` ganha esta exceção, e só ela.** Qualquer outro destino de saída fora dos provedores configurados continua proibido. Um novo destino precisa de um novo ADR.
5. A documentação de privacidade (#33) lista os três destinos, o gatilho de cada um e a chave para desligar. O teste de egresso de #34 usa esta lista como a dos destinos aprovados.

## Alternativas consideradas

- **B. Remover a busca remota** e atualizar o snapshot de preços no build de cada release. Cumpre a regra sem exceção, mas os preços ficam desatualizados entre releases, e o custo correto sem configuração é um dos motivos para usar o gateway.
- **C. Desligado por padrão (opt-in).** É a opção mais conservadora, mas os custos aparecem errados em toda instalação nova até o operador descobrir a chave e ligá-la.

## Consequências

- Uma instalação padrão consulta `openrouter.ai` e `models.dev` no boot e uma vez por dia. Quem roda isolado define `THINKER_CATALOG_SYNC=false` e aceita custos menos precisos.
- Os dados embutidos hoje cobrem poucos modelos. Com a busca desligada, a maioria dos modelos fica sem preço e o custo aparece como $0. Um snapshot mais completo, gerado no build, fica fora desta decisão; se for desejado, entra por issue própria.
- A implementação (chave, gate do OpenCode Go, testes e documentação de variáveis) é a issue #39, do v0.1, para o `backend-dev`, depois de #17.
- O egresso deixa de depender de ler código: #34 confere na rede que só esses destinos aparecem na rodada padrão e que nenhum aparece com `THINKER_CATALOG_SYNC=false`.
- Emenda a nota de "Consequências" do [ADR 0001](0001-fundacao-do-thinker.md) sobre chamadas de saída do snapshot.
