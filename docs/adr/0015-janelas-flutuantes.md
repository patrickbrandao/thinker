# ADR 0015: janelas flutuantes, não modais

- Status: aceita
- Data: 2026-11-21

## Contexto

O dashboard abria formulários, confirmações e detalhes em janelas modais: um fundo escurecido bloqueava a página e um clique fora da janela a fechava. Um clique fora sem querer descartava o que estava sendo editado (por exemplo, a edição de uma chave de API).

## Decisão

1. **Toda janela do sistema é flutuante.** Ela fica sobre a página sem bloqueá-la (sem fundo escurecido, a página atrás continua utilizável) e pode ser arrastada pela barra de título.
2. **Uma janela só fecha quando o usuário pede:** o botão de fechar (X) na barra de título, uma ação do conteúdo (Cancelar, Salvar, Confirmar, Concluir) ou a tecla Esc, que fecha só a janela flutuante aberta por último. **Um clique fora da janela nunca a fecha.**
3. **Modal (bloqueante) só quando o caso pedir explicitamente.** Ainda assim, o clique fora não fecha a janela.
4. Menus suspensos, popovers, tooltips e a paleta de comandos (Ctrl/Cmd+K) não são janelas: continuam fechando com clique fora ou Esc.

## Implementação

- `Modal` (`packages/frontend/src/components/ui.tsx`) renderiza por padrão um `FloatingWindow` (`role="dialog"`, `aria-modal="false"`, foco entra ao abrir e volta ao fechar, sem prender o Tab). Isso vale também para o `ConfirmDialog`.
- `<Modal modal>` é o modo bloqueante (fundo `.overlay`, `aria-modal="true"`, foco preso) e só deve ser usado quando o caso pedir um modal explicitamente.
- `FloatingWindow` é o componente das janelas maiores (arrastável e redimensionável, com rodapé fixo via `WindowFooter`).
- Componentes com overlay próprio seguem a mesma regra: sem fechar no clique fora.

## Consequências

- Mais de uma janela pode ficar aberta ao mesmo tempo. Quem abre uma janela a partir de uma lista precisa lidar com a troca do alvo (o formulário reinicia com o novo item).
- Os testes de janela verificam que o clique fora não fecha.
