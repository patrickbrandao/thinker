import type en from '../en/sessions.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  pageTitle: 'Sessões - Thinker',
  metaDescription: 'Sessões dos harnesses: duração, requisições, tokens e custo por sessão.',
  title: 'Sessões',
  subtitle:
    'Requisições agrupadas pelo id de sessão que cada harness envia nos cabeçalhos. Sessões de subagentes contam na sessão principal.',
  allHarnesses: 'Todos os harnesses',
  total: '{{ count }} sessões',
  emptyTitle: 'Nenhuma sessão ainda',
  emptyBody:
    'As sessões aparecem quando um harness informa a sessão em um cabeçalho da requisição (OpenCode, Claude Code, Codex, OpenClaw, Hermes ou x-session-key).',
  col: {
    session: 'Sessão',
    harness: 'Harness',
    started: 'Início',
    duration: 'Duração',
    requests: 'Requisições',
    tokens: 'Tokens',
    cost: 'Custo',
    models: 'Modelos',
    lastActivity: 'Última atividade',
  },
  active: 'Ativa',
  subagents: '+{{ count }} subagentes',
  failed: '{{ count }} com falha',
  more: '+{{ count }}',
  prev: 'Anterior',
  next: 'Próxima',
  detail: {
    pageTitle: 'Sessão {{ id }} - Thinker',
    back: '← Sessões',
    notFound: 'Sessão não encontrada',
    started: 'Início',
    ended: 'Última atividade',
    duration: 'Duração',
    requests: 'Requisições',
    inputTokens: 'Tokens de entrada',
    outputTokens: 'Tokens de saída',
    cacheRead: 'Leitura de cache',
    cost: 'Custo total',
    harness: 'Harness',
    models: 'Modelos',
    providers: 'Provedores',
    client: 'Cliente',
    project: 'Projeto',
    parent: 'Sessão principal',
    parts: 'Sessão principal e subagentes',
    main: 'Principal',
    subagent: 'Subagente',
    requestsTitle: 'Requisições desta sessão',
  },
};

export default ptBR;
