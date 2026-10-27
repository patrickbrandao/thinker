import type en from '../en/ui.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  dismissNotification: 'Dispensar notificação',
  unexpectedError: 'Ocorreu um erro inesperado. Tente de novo.',
  infoAria: 'Informação: {{ text }}',
  customEntry: 'Usar "{{ value }}" como entrada personalizada',
  selectPlaceholder: 'Selecione...',
  selectedCount: '{{ count }} selecionados',
  pagination: {
    label: 'Paginação',
    showing: 'Mostrando {{ start }}–{{ end }} de {{ total }}',
    previousAria: 'Ir para a página anterior',
    previous: 'Anterior',
    nextAria: 'Ir para a próxima página',
    next: 'Próxima',
  },
  copy: {
    revealFirst: 'Revele a chave primeiro',
    disabled: 'Cópia desativada',
    failed: 'Falha ao copiar',
    toClipboard: 'Copiar para a área de transferência',
  },
  filter: {
    all: 'Todos: {{ noun }} ({{ count }})',
    some: '{{ selected }} de {{ total }} {{ noun }}',
    selectAll: 'Selecionar todos',
  },
  auth: {
    subscription: 'Assinatura',
    local: 'Local',
    apiKey: 'Chave de API',
    subscriptionProvider: 'Provedor por assinatura',
    apiKeyProvider: 'Provedor por chave de API',
    localProvider: 'Provedor local',
  },
  feedback: {
    title: 'Enviar feedback',
    details: 'Conte mais detalhes (opcional)',
    submit: 'Enviar',
    tags: {
      notExpectedTier: 'Nível inesperado',
      poorQuality: 'Resposta de baixa qualidade',
      tooSlow: 'Lento demais',
      buggy: 'Com defeito',
      other: 'Outro',
    },
  },
  errors: {
    sessionExpired: 'Sessão expirada',
    unauthorized: 'Não autorizado',
    apiError: 'Erro da API: {{ status }} {{ statusText }}',
    requestFailed: 'A requisição falhou ({{ status }})',
    streamNoResult: 'O stream terminou sem resultado',
    bestAnswerFailed: 'Não foi possível marcar a melhor resposta',
    starFailed: 'Não foi possível alterar o favorito',
    pollFailed: 'A consulta falhou: {{ status }}',
    setupFailed: 'A configuração falhou ({{ status }})',
  },
  analytics: {
    recoveredRequests: 'Requisições bem-sucedidas que foram recuperadas por fallback.',
    totalAttempts:
      'Toda chamada a um provedor conta aqui, inclusive as repetições de fallback. Uma requisição pode gerar várias tentativas.',
    modelSuccessRate: 'Tentativas bem-sucedidas sobre todas as tentativas deste modelo.',
    providerSuccessRate: 'Tentativas bem-sucedidas sobre todas as tentativas deste provedor.',
    connectionSuccessRate30d:
      'Tentativas bem-sucedidas sobre todas as tentativas desta conexão, nos últimos 30 dias.',
    connectionSuccessRate:
      'Tentativas bem-sucedidas sobre todas as tentativas desta conexão, no período filtrado.',
    connectionHarnessSuccessRate:
      'Tentativas bem-sucedidas sobre todas as tentativas deste harness nesta conexão.',
    harnessSuccessRate: 'Requisições bem-sucedidas sobre todas as requisições deste harness.',
    harnessTotalRequests:
      'Requisições lógicas deste harness, uma por chamada, seja qual for o número de tentativas.',
    requestSuccessRate:
      'Requisições bem-sucedidas sobre todas as requisições. As recuperadas contam como bem-sucedidas.',
  },
};

export default ptBR;
