# ADR 0007 — Dashboard em React, Tailwind 4 e React Flow

- **Status:** aceito
- **Data:** 2026-10-27
- **Substitui:** a parte "SolidJS/Vite" da stack em `docs/decisoes-iniciais.md` (seção Stack)

## Contexto

O dashboard herdado do upstream é SolidJS com CSS próprio. O mantenedor pediu uma reorganização da interface (ícones de busca, tema e alertas no topo; sidebar recolhível com ícones; menu do usuário no canto inferior esquerdo, com organização, administração e integrações) e uma visualização da topologia e do uso em forma de fluxo com React Flow. O React Flow só existe para React. A skill de layout de referência (`web-interface-admin-with-canva-v2`) descreve um console em React 19 com Tailwind 4, tokens por papel, paleta ⌘K e um canvas React Flow.

## Decisão

1. **O dashboard passa a ser React 19** (react-router 7, Vite 8). Todo o frontend é migrado de uma vez, com os mesmos testes portados para React Testing Library; não há convivência de Solid e React.
2. **Estilo com Tailwind 4 e tokens de design** (`src/styles/tokens.css`): fundos, fios, quatro níveis de texto, um acento azul, estados e portas, nos temas claro e escuro. Componentes não usam hex nem a variante `dark:` para cores; superfícies fixas não têm sombra. As fontes continuam locais (DM Sans e JetBrains Mono), sem Google Fonts, pela regra de não fazer chamadas externas.
3. **Shell novo:** sidebar com ícones e labels, recolhível; no topo, Documentação e os ícones Procurar (paleta ⌘K com busca no servidor), Alterar tema e Alertas; o menu do usuário fica no rodapé da sidebar e reúne preferências da conta, a organização atual (com troca e criação), membros, administração de usuários e integrações (MCP e CLI). Organização e Integrações saem do menu principal. A navegação principal fica num arquivo só (`src/config/navigation.tsx`).
4. **Busca e alertas no backend:** `GET /api/v1/search?q=` procura, só na organização ativa, harnesses, conexões, provedores custom, modelos virtuais, header tiers, modelos do catálogo e membros; `GET /api/v1/alerts` lista as requisições com falha das últimas 24 horas. O "visto" dos alertas fica no navegador.
5. **React Flow só como fundação:** componentes de canvas (`src/components/flow/`), vocabulário de nós (entrada, roteamento, provedor, pool), auto layout e a página `/topology`, carregados sob demanda num chunk próprio. O adaptador com os dados reais (`GET /api/v1/topology`) entrou na versão seguinte.

## Consequências

- A dependência de `solid-js`, `@solidjs/*` e `@solid-primitives/i18n` sai; o i18n continua com os mesmos catálogos e chaves, agora com um `t()` próprio tipado.
- O agente `frontend-dev` e o guia técnico passam a falar em React.
- O bundle inicial cresce (React é maior que Solid); o React Flow fica fora dele.
