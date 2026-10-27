import type en from '../en/org.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  roles: {
    owner: 'Proprietário',
    admin: 'Administrador',
    member: 'Membro',
    viewer: 'Leitor',
  },
  yourRole: 'Seu papel: {{ role }}',
  switcher: {
    label: 'Organização',
    newOrg: 'Nova organização',
  },
  gate: {
    loadFailed: 'Não foi possível carregar sua conta',
    couldNotLoad: 'Não foi possível carregar sua conta',
    noOrg: 'Nenhuma organização',
    noOrgAdmin:
      'Ainda não existe nenhuma organização. Crie uma para começar a adicionar harnesses e provedores.',
    orgName: 'Nome da organização',
    createOrg: 'Criar organização',
    notMember:
      'Sua conta não faz parte de nenhuma organização. Peça a um administrador para adicionar você.',
  },
  tempPassword: {
    title: 'Senha temporária de {{ email }}',
    warning:
      'Copie agora e compartilhe de forma segura. Ela não será mostrada de novo. O usuário precisa escolher uma nova senha no primeiro acesso.',
    saved: 'Já salvei',
  },
  page: {
    title: 'Organização',
    metaDescription: 'Gerencie o nome e os membros da organização.',
    subtitle: 'Membros, papéis e configurações desta organização.',
    renamed: 'Organização renomeada',
    existingAdded: '{{ email }} já tinha uma conta e foi adicionado',
    general: 'Geral',
    nameDesc: 'Aparece no seletor de organização.',
    nameReadOnly: 'Só proprietários podem renomear a organização.',
    members: 'Membros',
    addMember: 'Adicionar membro',
    nameNewAccounts: 'Nome (contas novas)',
    member: 'Membro',
    loadingMembers: 'Carregando membros...',
    you: '(você)',
    roleOf: 'Papel de {{ email }}',
    active: 'Ativo',
    pendingPassword: 'Troca de senha pendente',
    confirmRemove: 'Confirmar remoção',
    dangerZone: 'Zona de perigo',
    deleteThis: 'Excluir esta organização',
    deleteDesc:
      'Exclui de vez a organização com seus harnesses, provedores, roteamento e logs de requisições. Esta ação não pode ser desfeita.',
    deleteOrg: 'Excluir organização',
    deleteNamed: 'Excluir {{ name }}',
    deleteWarning:
      'Tudo nesta organização é excluído para todos os membros. Esta ação não pode ser desfeita.',
    typeToConfirmBefore: 'Para confirmar, digite',
    typeToConfirmAfter: 'na caixa abaixo',
  },
  users: {
    title: 'Usuários',
    metaDescription: 'Gerencie as contas desta instância do Thinker.',
    adminGranted: 'Acesso de administrador da instância concedido',
    adminRevoked: 'Acesso de administrador da instância revogado',
    notAvailable: 'Indisponível',
    adminsOnly: 'Só administradores da instância podem gerenciar contas de usuário.',
    subtitle:
      'Todas as contas desta instância do Thinker. Contas novas recebem uma senha temporária e precisam trocá-la no primeiro acesso.',
    create: 'Criar usuário',
    orgOptional: 'Organização (opcional)',
    instanceAdmin: 'Administrador da instância',
    all: 'Todos os usuários',
    user: 'Usuário',
    organizations: 'Organizações',
    created: 'Criado',
    loading: 'Carregando usuários...',
    instanceAdminOf: 'Administrador da instância: {{ email }}',
    cannotRevokeSelf: 'Você não pode revogar seu próprio acesso de administrador',
    resetPassword: 'Redefinir senha',
    confirmReset: 'Confirmar redefinição',
  },
};

export default ptBR;
