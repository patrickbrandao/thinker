import type en from '../en/format.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  perRequestTiny: 'Incluído (< {{ amount }} de cota/req.)',
  perRequest: 'Incluído ({{ amount }} de cota/req.)',
  yesterday: 'Ontem',
  justNow: 'Agora mesmo',
  minutesAgo: 'há {{ n }} min',
  hoursAgo: 'há {{ n }} h',
  daysAgo: 'há {{ n }} d',
  status: {
    ok: 'Sucesso',
    success: 'Sucesso',
    retry: 'Repetida',
    error: 'Falhou',
    failed: 'Falhou',
    rate_limited: 'Falhou',
    fallback_error: 'Tratada',
    pending: 'Pendente',
    cancelled: 'Cancelada',
  },
  errorOrigin: {
    provider: 'Provedor',
    transport: 'Transporte',
    config: 'Thinker · Configuração',
    policy: 'Thinker · Limite',
    internal: 'Thinker · Interno',
    request: 'Thinker · Requisição inválida',
  },
  errorClass: {
    rate_limit: 'Limite de taxa',
    auth: 'Autenticação',
    invalid_request: 'Requisição inválida',
    not_found: 'Não encontrado',
    payload_too_large: 'Payload grande demais',
    billing: 'Cobrança',
    server_error: 'Erro do servidor',
    client_error: 'Erro do cliente',
    timeout: 'Tempo esgotado',
    network: 'Rede',
    no_provider: 'Nenhum provedor configurado',
    no_provider_key: 'Chave de API ausente',
    subscription_credentials_unusable: 'Credenciais da assinatura',
    limit_exceeded: 'Limite excedido',
    internal: 'Erro interno',
  },
  metric: {
    tokens: 'Uso de tokens',
    cost: 'Custo',
  },
};

export default ptBR;
