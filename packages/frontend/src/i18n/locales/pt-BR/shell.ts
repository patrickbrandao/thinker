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
    subtitle: 'Como o tráfego sai dos harnesses, passa pelo roteamento e chega aos provedores.',
    hint: 'Clique duas vezes num nó para abri-lo.',
    empty: 'Nenhum harness ainda. Crie um e as rotas e provedores dele vão aparecer aqui.',
    emptyActive: 'Nenhum tráfego neste período.',
    activeOnly: 'Só com tráfego',
    ranges: { '1h': '1h', '24h': '24h', '7d': '7d', '30d': '30d' },
    range: 'Período',
    kinds: {
      client: 'Cliente',
      entry: 'Harness',
      hub: 'Rota',
      item: 'Provedor',
      group: 'Pool',
    },
    hubs: { auto: 'Roteamento auto', virtual: 'Modelo virtual' },
    links: { primary: 'Rota principal', fallback: 'Fallback', usage: 'Usado, sem rota' },
    auth: { api_key: 'Chave de API', subscription: 'Assinatura', local: 'Local' },
    disabled: 'desativado',
    notConnected: 'não conectado',
    models: (n: number) => `${n} modelo${n === 1 ? '' : 's'}`,
    metrics: {
      requests: (n: string) => `${n} req`,
      errors: (n: string) => `${n} erro${n === '1' ? '' : 's'}`,
    },
  },
};

export default shell;
