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
  updateTierFailed: 'Não foi possível atualizar o nível',
  toggleTierFailed: 'Não foi possível ativar ou desativar o nível',
  deleteTierFailed: 'Não foi possível excluir o nível',
  manageCustomRouting: 'Gerenciar roteamento personalizado',
  createCustomTier: 'Criar nível personalizado',
  howRoutingWorks: 'Como o roteamento funciona',
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
    resetAll: 'Voltar tudo para automático',
    setupInstructions: 'Instruções de configuração',
  },
  defaultTier: {
    title: 'Roteamento padrão',
    routeByComplexity: 'Rotear por complexidade',
    complexitySubtitle:
      'Analisa a complexidade de cada requisição na hora e a envia para o nível correspondente.',
  },
  headerTiers: {
    title: 'Roteamento personalizado',
    subtitle:
      'Atribua requisições a níveis com base nos headers HTTP. O roteamento personalizado é avaliado antes de qualquer outro método de roteamento.',
    loadFailed: 'Não foi possível carregar os níveis personalizados',
    manageDesc: 'Ative ou desative níveis. Crie níveis novos ou edite-os direto no card.',
    createNew: 'Criar nível novo',
    emptyTitle: 'Nenhum nível personalizado ativo',
    emptyDesc:
      'Crie ou ative níveis personalizados para enviar as requisições correspondentes aos modelos que você escolher.',
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
    custom: 'Personalizado',
  },
  pipeline: {
    customName: 'Roteamento personalizado',
    customDesc:
      'Se um header da requisição corresponder à regra de um nível personalizado, ela vai para o modelo correspondente.',
    specificityName: 'Roteamento por tarefa',
    specificityDesc:
      'O Thinker analisa a consulta semanticamente e, se ela corresponder a um nível por tarefa ativo (programação, geração de imagens…), envia para o modelo correspondente.',
    defaultName: 'Roteamento padrão:',
    complexity: 'complexidade',
    regular: 'normal',
    complexityDesc:
      'O Thinker analisa a consulta semanticamente, avalia a complexidade e a atribui a um nível que vai de “simples” a “raciocínio”.',
    regularDesc: 'As demais requisições vão para o modelo padrão e seus fallbacks.',
    summary:
      'O roteamento permite que o Thinker intercepte as consultas na hora e as redirecione para o modelo correspondente.',
    current: 'Assim está a sua configuração atual:',
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
  headerTierCard: {
    sendHeader: 'Enviar este header',
    editTier: 'Editar nível',
  },
  snippet: {
    title: 'Envie o header “{{ name }}”',
    noModel: 'nenhum modelo atribuído (usa o roteamento padrão)',
    descBefore: 'Adicione este header a qualquer requisição e ela será roteada para',
    descAfter: '.',
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
  headerTierModal: {
    editTitle: 'Editar nível personalizado',
    editDesc:
      'Atualize a regra de header, o nome ou a cor deste nível. O modelo e os fallbacks são gerenciados no card.',
    createDesc:
      'O roteamento personalizado identifica requisições pelos headers e atribui modelos específicos a elas.',
    saving: 'Salvando…',
    creating: 'Criando…',
    create: 'Criar nível',
    createFailed: 'Não foi possível criar o nível',
    seenCount: 'visto {{ count }}×',
    nameRequired: 'O nome é obrigatório',
    nameTooLong: 'O nome deve ter no máximo {{ max }} caracteres',
    nameTaken: 'Já existe um nível com este nome',
    keyRequired: 'A chave do header é obrigatória',
    keyInvalid: 'A chave do header só pode ter letras minúsculas, dígitos e hífens',
    keyReserved: 'Este header é removido por segurança e não pode ser usado como regra',
    valueRequired: 'O valor do header é obrigatório',
    valueTooLong: 'O valor do header deve ter no máximo {{ max }} caracteres',
    valueQuotes: 'O valor do header não pode ter aspas nem barras invertidas',
    valueTaken: 'Outro nível já usa esta chave e este valor de header',
    tierName: 'Nome do nível',
    tierNamePlaceholder: 'Meu nível personalizado',
    headerKey: 'Chave do header',
    headerValue: 'Valor do header',
    useCustomHeader: 'Usar "{{ value }}" como header personalizado',
    useCustomValue: 'Usar "{{ value }}" como valor personalizado',
    badgeColor: 'Cor do selo',
    incompatible: (n: number) =>
      n === 1
        ? 'Este modelo não suporta streaming. Troque-o para ativar o modo stream.'
        : 'Estes modelos não suportam streaming. Troque-os para ativar o modo stream.',
    warmupLabel: 'Aquecimento do stream (segundos)',
    warmupPlaceholder: 'Herdar',
    warmupHelp:
      'Opcional. Quanto tempo uma requisição em stream espera pelo primeiro token antes do failover. Deixe em branco para usar a configuração da conexão ou o padrão.',
    confirmDelete: 'Excluir o nível "{{ name }}"?',
    deleteTier: 'Excluir nível',
  },
  colors: {
    slate: 'ardósia',
    gray: 'cinza',
    zinc: 'zinco',
    stone: 'pedra',
    red: 'vermelho',
    orange: 'laranja',
    amber: 'âmbar',
    yellow: 'amarelo',
    lime: 'lima',
    green: 'verde',
    emerald: 'esmeralda',
    teal: 'verde-azulado',
    cyan: 'ciano',
    sky: 'céu',
    blue: 'azul',
    indigo: 'índigo',
    violet: 'violeta',
    purple: 'roxo',
    fuchsia: 'fúcsia',
    pink: 'rosa',
    rose: 'rosé',
    coral: 'coral',
    brown: 'marrom',
    navy: 'azul-marinho',
  },
};

export default ptBR;
