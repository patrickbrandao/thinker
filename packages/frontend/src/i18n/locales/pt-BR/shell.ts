import type en from '../en/shell.js';
import type { Catalog } from '../../types.js';

const shell: Catalog<typeof en> = {
  sidebar: {
    collapse: 'Recolher menu',
    expand: 'Expandir menu',
  },
  topbar: {
    breadcrumb: 'Trilha de navegação',
    search: 'Procurar (⌘K)',
    themeLight: 'Mudar para o tema claro',
    themeDark: 'Mudar para o tema escuro',
  },
  user: {
    organization: 'Organização',
    role: 'Seu papel: {{ role }}',
    instanceAdmin: 'admin da instância',
    manageOrganization: 'Organização e membros',
    viewOrganization: 'Dados da organização',
    switchOrganization: 'Trocar de organização',
    newOrganization: 'Nova organização',
    administration: 'Administração',
  },
  alerts: {
    title: 'Alertas',
    labelUnseen: (count: number) => `Alertas, ${count} novos`,
    window: 'Últimas 24 horas',
    markSeen: 'Marcar todos como vistos',
    empty: 'Nenhuma requisição falhou nas últimas 24 horas.',
    viewAll: 'Ver requisições com falha',
    viewAllCount: (count: number) => `Ver todas as ${count} requisições com falha`,
  },
  palette: {
    label: 'Paleta de comandos',
    placeholder: 'Procurar páginas, harnesses, provedores, modelos…',
    goTo: 'Ir para',
    actions: 'Ações',
    toggleTheme: 'Alternar tema claro/escuro',
    noResults: 'Nada encontrado.',
    navigate: 'navegar',
    open: 'abrir',
    hint: 'Digite ao menos 2 caracteres para procurar',
    types: {
      harness: 'Harnesses',
      connection: 'Conexões de provedores',
      custom_provider: 'Provedores custom',
      virtual_model: 'Modelos virtuais',
      model: 'Modelos',
      member: 'Membros',
    },
  },
  flow: {
    subtitle:
      'Como as requisições saem dos clientes, passam pelos harnesses e provedores e chegam à internet.',
    hint: 'Arraste os nós para organizá-los. Clique duas vezes num nó para abri-lo.',
    empty: 'Nenhum harness ainda. Crie um e os provedores dele vão aparecer aqui.',
    emptyActive: 'Nenhum tráfego neste período.',
    activeOnly: 'Só com tráfego',
    resetLayout: 'Reorganizar',
    ranges: { '1h': '1h', '24h': '24h', '7d': '7d', '30d': '30d' },
    range: 'Período',
    links: { route: 'Rota', fallback: 'Fallback', error: 'Erros' },
    auth: { api_key: 'Chave de API', subscription: 'Assinatura', local: 'Local' },
    proxy: 'Proxy',
    globalProxy: 'Global',
    egress: { internet: 'Internet', local: 'Rede local' },
    disabled: 'desativado',
    metrics: {
      requests: (n: string) => `${n} req`,
      errors: (n: string) => `${n} erro${n === '1' ? '' : 's'}`,
      tokens: (n: string) => `${n} tokens`,
      idle: 'Sem tráfego neste período',
    },
  },
};

export default shell;
