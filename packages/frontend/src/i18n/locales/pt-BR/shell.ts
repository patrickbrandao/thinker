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
      header_tier: 'Header tiers',
      model: 'Modelos',
      member: 'Membros',
    },
  },
  flow: {
    subtitle: 'Como o tráfego sai dos harnesses, passa pelo roteamento e chega aos provedores.',
    preview: 'Prévia',
    emptyHint:
      'A visão de topologia está em preparação. Harnesses, rotas e provedores vão aparecer aqui.',
    kinds: {
      entry: 'Harness',
      hub: 'Rota',
      item: 'Provedor',
      group: 'Pool',
    },
  },
};

export default shell;
