import type en from '../en/limits.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  pageTitle: 'Limites de {{ name }} - Thinker',
  metaDescription: 'Configure limites e alertas para {{ name }}.',
  subtitle:
    'Receba avisos ou bloqueie requisições quando os limites de tokens ou de custo forem ultrapassados',
  createRule: 'Criar regra',
  editRule: 'Editar regra',
  hardLimitTriggered:
    'Um ou mais limites rígidos foram atingidos. Novas requisições de proxy deste harness ficam bloqueadas até o uso zerar no próximo período.',
  connectProviderTitle: 'Conecte um provedor para definir limites rígidos',
  connectProviderBody:
    'Limites rígidos bloqueiam automaticamente as requisições de proxy quando o uso passa de um valor. Os alertas funcionam sem provedor conectado — só os limites rígidos precisam de um.',
  readOnlyNotice:
    'Você tem acesso somente leitura a limites e notificações. Só administradores e proprietários podem alterá-los.',
  toast: {
    ruleUpdated: 'Regra atualizada',
    ruleCreated: 'Regra criada',
    ruleDeleted: 'Regra excluída',
  },
  tokensValue: '{{ value }} tokens',
  period: {
    hour: 'Por hora',
    day: 'Por dia',
    week: 'Por semana',
    month: 'Por mês',
  },
  history: {
    title: 'Histórico',
    date: 'Data',
    usage: 'Uso',
    threshold: 'Limite',
    resetsAt: 'Zera em',
    empty: 'Nenhum alerta disparado ainda',
  },
  table: {
    title: 'Regras',
    type: 'Tipo',
    threshold: 'Limite',
    triggered: 'Disparos',
    actions: 'Ações',
    emptyTitle: 'Nenhuma regra ainda',
    emptyBody:
      'Crie alertas para picos de uso ou limites rígidos para bloquear requisições acima do orçamento.',
    emailAlert: 'Alerta',
    hardLimit: 'Limite rígido',
    noProvider: 'Sem trigger',
    ruleOptions: 'Opções da regra',
  },
  modal: {
    desc: 'Os triggers ligados a este harness com Alerta de limite recebem um evento quando o uso passar do limite.',
    metric: 'Métrica',
    tokens: 'Tokens',
    costUsd: 'Custo (USD)',
    threshold: 'Limite',
    costPlaceholder: 'ex.: 10.00',
    tokensPlaceholder: 'ex.: 50000',
    period: 'Período',
    blockWhenExceeded: 'Bloquear requisições quando ultrapassar',
  },
  deleteModal: {
    title: 'Excluir regra',
    bodyBefore: 'Isso vai excluir permanentemente a regra de',
    token: 'tokens',
    cost: 'custo',
    bodyAfter: '({{ threshold }} {{ period }}). Esta ação não pode ser desfeita.',
    confirm: 'Entendo que esta ação é irreversível',
    submit: 'Excluir regra',
  },
};

export default ptBR;
