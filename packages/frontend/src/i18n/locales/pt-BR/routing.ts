import type en from '../en/routing.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  stream: 'Stream',
  buffered: 'Buffered',
  streamModeEnabled: 'Modo de resposta em stream ativado',
  bufferedModeEnabled: 'Modo de resposta buffered ativado',
  responseModeFailed: 'Não foi possível atualizar o modo de resposta',
  fallbackAdded: 'Fallback adicionado',
  fallbackAddFailed: 'Não foi possível adicionar o fallback',
  fallbacksUpdateFailed: 'Não foi possível atualizar os fallbacks',
  pinnedToKey: 'Fixado na chave "{{ label }}"',
  keyPinCleared: 'Chave fixada removida',
  defaultSubtitle: 'Escolha um modelo e até 5 fallbacks como seu roteamento padrão.',
  reset: 'Redefinir',
  addModel: '+ Adicionar modelo',
  change: 'Trocar',
  changeModelFor: 'Trocar o modelo de {{ name }}',
  auto: 'auto',
  skippedInStream: 'Ignorado em stream',
  skippedWhileStream: 'Ignorado enquanto o modo stream estiver ativo',
  includedInSubscription: 'Incluído na assinatura',
  pricePerM: '{{ input }} entrada · {{ output }} saída por 1M',
  free: 'Grátis',
  warmupError: 'Informe um valor entre {{ min }} e {{ max }} segundos ou deixe em branco.',
  deprecation: {
    title: 'O roteamento por regras está sendo descontinuado.',
    body: 'Você ainda pode usá-lo até 1º de setembro de 2026, mas recomendamos migrar para o roteamento padrão ou personalizado.',
  },
  page: {
    title: 'Roteamento de {{ name }}',
    metaDescription: 'Configure o roteamento de modelos de {{ name }}.',
    readOnlyNotice:
      'Você tem acesso somente leitura ao roteamento. Só administradores e proprietários podem alterá-lo.',
    toggleComplexityFailed: 'Não foi possível alternar o roteamento por complexidade',
    specificityResponseModeFailed:
      'Não foi possível atualizar o modo de resposta do roteamento por tarefa',
    pricingSyncOff:
      'Os preços dos modelos não estão disponíveis porque a sincronização do catálogo está desligada (THINKER_CATALOG_SYNC). Os custos dos modelos podem estar incompletos.',
    pricingUnavailable:
      'Os preços dos modelos não estão disponíveis. Os custos dos modelos podem estar incompletos.',
    specificityModelFailed: 'Não foi possível atualizar o modelo da tarefa',
    modelsRefreshed: 'Modelos atualizados',
    refreshModelsFailed: 'Não foi possível atualizar os modelos',
    refreshing: 'Atualizando...',
    refreshModels: 'Atualizar modelos',
    responseModeLabel: 'Modo de resposta: {{ mode }}',
    resetFailed: 'Não foi possível redefinir',
    gotIt: 'Entendi',
  },
  actions: {
    routingUpdated: 'Roteamento atualizado',
    allTiersCleared: 'Rotas de todos os níveis removidas',
    tierCleared: 'Rota do nível removida',
  },
  panels: {
    keyCount: '{{ count }} chaves ({{ auth }})',
    defaultKey: 'Padrão',
    connections: (n: number) => `${n} ${n !== 1 ? 'conexões' : 'conexão'}`,
  },
  defaultTier: {
    title: 'Roteamento padrão',
    routeByComplexity: 'Rotear por complexidade',
    complexitySubtitle:
      'Analisa a complexidade de cada requisição na hora e a envia para o nível correspondente.',
  },
  specificity: {
    title: 'Roteamento por tarefa',
    subtitle:
      'Envie tarefas específicas (programação, trading, geração de imagens…) para modelos dedicados. Tem prioridade sobre o roteamento padrão e por complexidade quando a tarefa corresponde.',
    manage: 'Gerenciar roteamento por tarefa',
    modalDesc:
      'Envie tarefas especializadas para modelos dedicados. Tem prioridade sobre o roteamento por complexidade e o padrão quando a tarefa corresponde.',
    emptyTitle: 'Nenhum nível por tarefa ainda',
    emptyDesc: 'Envie tarefas especializadas para modelos dedicados.',
    addTier: 'Adicionar nível por tarefa',
    enabledToast: 'Roteamento de {{ label }} ativado',
    disabledToast: 'Roteamento de {{ label }} desativado',
    updateFailed: 'Não foi possível atualizar o roteamento por tarefa',
    enableStage: 'Ativar {{ label }}',
    disableStage: 'Desativar {{ label }}',
  },
  stages: {
    default: { label: 'Padrão', desc: 'Atende todas as requisições.' },
    simple: {
      label: 'Simples',
      desc: 'Heartbeats, saudações e tarefas baratas que qualquer modelo resolve.',
    },
    standard: {
      label: 'Padrão',
      desc: 'Requisições de uso geral que pedem bom equilíbrio entre qualidade e custo.',
    },
    complex: {
      label: 'Complexo',
      desc: 'Tarefas que exigem alta qualidade, nuance ou raciocínio em várias etapas.',
    },
    reasoning: {
      label: 'Raciocínio',
      desc: 'Raciocínio avançado, planejamento e decisões críticas.',
    },
    coding: { label: 'Programação', desc: 'Escrever, depurar e refatorar código.' },
    web_browsing: {
      label: 'Navegação web',
      desc: 'Navegar em páginas, pesquisar e extrair conteúdo.',
    },
    data_analysis: {
      label: 'Análise de dados',
      desc: 'Fazer contas, rodar estatísticas, montar gráficos.',
    },
    image_generation: {
      label: 'Geração de imagens',
      desc: 'Criar e editar imagens, logos e visuais.',
    },
    video_generation: { label: 'Geração de vídeos', desc: 'Produzir clipes, animações e edições.' },
    social_media: {
      label: 'Redes sociais',
      desc: 'Escrever posts, planejar conteúdo, acompanhar o engajamento.',
    },
    email_management: {
      label: 'E-mail',
      desc: 'Escrever, responder e organizar a caixa de entrada.',
    },
    calendar_management: {
      label: 'Agenda',
      desc: 'Marcar reuniões, ver disponibilidade, remarcar.',
    },
    trading: { label: 'Trading', desc: 'Analisar mercados, fazer operações, acompanhar posições.' },
  },
  tierCard: {
    virtualModelLabel: 'Modelo virtual:',
    resetTitle: 'Redefinir o nível?',
    resetBody: 'Isso remove o modelo escolhido e todos os modelos de fallback deste nível.',
  },
  chain: {
    options: 'Opções',
    optionsFor: 'Opções de {{ name }}',
  },
  fallbacks: {
    pinned: 'Fallback fixado em "{{ label }}"',
    pinCleared: 'Chave fixada do fallback removida',
    subscription: 'Assinatura',
    apiKey: 'Chave de API',
    removed: 'Fallback removido',
    orderUpdated: 'Ordem dos fallbacks atualizada',
    custom: 'Personalizado',
    removeTitle: 'Remover fallback',
    removeModel: 'Remover {{ model }}',
    emptyTitle: 'Nenhum fallback',
    emptyDesc: 'Adicione modelos de fallback para garantir uma resposta se o provedor falhar.',
    add: 'Adicionar fallback',
  },
  tabs: {
    label: 'Camadas de roteamento',
    default: 'Padrão',
    specificity: 'Por tarefa',
  },
  instructions: {
    deactivate: 'Desativar roteamento',
    setUpHarness: 'Configurar harness:',
    connectDesc: 'Conecte seu harness ao Thinker para começar a rotear requisições.',
    disableDesc:
      'Isso para de rotear as requisições pelo Thinker e restaura o acesso direto ao modelo no seu harness OpenClaw.',
    pickModel: '1. Escolha o modelo que o harness deve usar diretamente:',
    runCommands:
      '2. Rode estes comandos no terminal do harness para restaurar o acesso direto ao modelo:',
    terminal: 'Terminal',
  },
  keyChip: {
    label: 'Chave de API de {{ model }}: atualmente {{ current }}. Clique para trocar.',
    choose: 'Escolher chave de API',
    clear: 'Remover fixação',
  },
  keyPicker: {
    title: 'Qual chave do {{ provider }}?',
    pickingFor: 'Escolhendo uma chave para',
    choose: 'Escolha uma chave do {{ provider }}',
  },
  responseMode: {
    title: 'Modo de resposta',
    streamMode: 'Modo stream',
    bufferedDesc: 'As respostas chegam em um único payload quando o modelo termina de gerar.',
    bufferedDescAll:
      'As respostas chegam em um único payload quando o modelo termina de gerar. Compatível com todos os modelos.',
    streamDesc: 'As respostas chegam em stream, token a token, conforme o modelo gera.',
    streamDescOnly:
      'As respostas chegam em stream, token a token, conforme o modelo gera. Só são usados modelos com suporte a streaming.',
    unavailable: (n: number) =>
      n === 1
        ? 'O modo stream não está disponível porque este modelo não suporta streaming. Troque-o para ativar o modo stream.'
        : 'O modo stream não está disponível porque estes modelos não suportam streaming. Troque-os para ativar o modo stream.',
    primary: 'Principal',
    fallbackN: 'Fallback {{ n }}',
  },
};

export default ptBR;
