# ADR 0001 — Fundação do Thinker

- **Status:** aceito
- **Data:** 2026-10-10

## Contexto

Queremos um gateway LLM entre harnesses e provedores de inferência, para uso pessoal e de pequenas empresas, que evolua no nosso ritmo. O [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) (MIT) já resolve o núcleo do problema, mas tem dois obstáculos. O primeiro é que ele carrega a camada SaaS da Manifest, phone-home e dependência de serviços externos dela. O segundo é que ele modela um usuário por tenant.

## Decisão

Continuar o software a partir de um snapshot sem histórico do upstream (`manifest@6.28.6`), com rebranding total para Thinker e sem obrigação de compatibilidade. O desenvolvimento é conduzido por agentes do Claude Code, e um deles acompanha o upstream semanalmente, sem portar código automaticamente. Os detalhes estão em [`docs/decisoes-iniciais.md`](../decisoes-iniciais.md).

## Alternativas consideradas

- **Fork no GitHub:** facilita merges do upstream, mas amarra o projeto visual e operacionalmente ao mnfst.
- **Repo com histórico completo:** permite `git diff` com o upstream. Foi preterido em favor de um repositório limpo; a âncora em `upstream/BASELINE` cobre a comparação.
- **Reescrever do zero:** meses de trabalho sem ganho para o usuário.

## Consequências

- Portar mudanças do upstream exige julgamento caso a caso, e o código vai divergir rapidamente com o rebranding e as organizações.
- O aviso de copyright da MNFST, Inc. permanece no `LICENSE`.
- O snapshot ainda contém chamadas de saída (outbound) para serviços externos, incluindo o `modelparams.dev` da Manifest e catálogos externos de modelos e preços. A v0.1 remove ou documenta cada uma delas (ver as issues #11 e #17); até lá, o código importado **não** cumpre a regra de não fazer phone-home. *Emenda:* o [ADR 0003](0003-excecao-catalogos-publicos.md) fixa a lista final. O `modelparams.dev` sai, e OpenRouter, models.dev e o documento do OpenCode Go ficam como a única exceção documentada, com `THINKER_CATALOG_SYNC=false` para desligar.
- Removemos funcionalidades que dependiam de serviços da Manifest (Autofix, Gemini Free gerenciado); o self-heal volta com implementação local no roadmap.
