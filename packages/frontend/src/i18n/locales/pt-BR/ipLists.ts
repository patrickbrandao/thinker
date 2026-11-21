import type en from '../en/ipLists.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  title: 'ACL IP',
  metaDescription:
    'Listas de endereços e prefixos IP às quais as chaves de harness podem ser restritas.',
  subtitle:
    'Listas nomeadas de endereços IPv4 e IPv6 ou prefixos CIDR. Cada chave de API de um harness pode ser aceita só a partir dos endereços das listas escolhidas.',
  adminOnly: 'Só admins e owners podem ver e gerenciar ACLs IP.',
  create: 'Nova ACL IP',
  list: {
    emptyTitle: 'Nenhuma ACL IP ainda',
    emptyBody:
      'Crie uma ACL IP e escolha-a para uma chave na aba Chaves de API de um harness, em Restrição de IP de origem.',
    name: 'Nome',
    entries: 'Entradas',
    harnesses: 'Usada por',
    updated: 'Atualizada',
    none: 'Nenhum',
    actions: 'Ações',
    menu: 'Ações de {{ name }}',
    edit: 'Editar',
    remove: 'Remover',
    removeInUse: 'Em uso por chaves de API: desvincule-as na guia Excluir do editor',
  },
  form: {
    title: 'ACL IP',
    createTitle: 'Nova ACL IP',
    editTitle: 'ACL IP {{ name }}',
    name: 'Nome',
    description: 'Descrição',
    entries: 'Entradas',
    entriesCount: '{{ count }} entradas',
    rows: 'Linhas',
    text: 'Texto',
    prefix: 'Endereço ou prefixo',
    label: 'Rótulo',
    labelPlaceholder: 'opcional',
    addRow: 'Adicionar entrada',
    removeRow: 'Remover entrada {{ prefix }}',
    textHint:
      'Um endereço ou prefixo por linha, com rótulo opcional depois de um espaço ou #. Linhas que começam com # são ignoradas.',
    textPlaceholder: '203.0.113.0/24 escritorio\n2001:db8::/48 # VPN\n198.51.100.7',
    hint: 'Endereços IPv4 ou IPv6 (salvos como /32 ou /128) ou prefixos CIDR como 203.0.113.0/24 ou 2001:db8::/48.',
    createSubmit: 'Criar ACL IP',
    errors: {
      name: 'Dê um nome à ACL IP.',
      prefix: 'Não é um endereço IP nem prefixo CIDR.',
      line: 'Linha {{ line }}: {{ prefix }} não é um endereço IP nem prefixo CIDR.',
      tooMany: 'No máximo {{ max }} entradas.',
    },
  },
  tabs: {
    entries: 'Endereços IP',
    general: 'Geral',
    keys: 'Chaves de API',
    delete: 'Excluir',
  },
  keys: {
    none: 'Nenhuma chave de API usa esta ACL IP.',
    harness: 'Harness',
    key: 'Chave',
    lists: 'ACLs IP na chave',
    onlyThis: 'Só esta',
  },
  delete: {
    title: 'Excluir {{ name }}?',
    unused: 'Nenhuma chave de API usa esta ACL IP. A exclusão não pode ser desfeita.',
    inUse:
      'A exclusão retira esta ACL IP das {{ count }} chave(s) de API que a usam e depois a exclui. Não dá para desfazer.',
    loseRestriction:
      'Estas chaves não têm outra ACL IP: a restrição de IP de origem delas será desligada e passarão a aceitar qualquer endereço:',
    button: 'Excluir ACL IP',
    buttonUnlink: 'Desvincular chaves e excluir',
  },
  removeModal: {
    title: 'Remover ACL IP',
    body: 'Remover {{ name }}? Não dá para desfazer.',
    submit: 'Remover',
  },
  toast: {
    created: 'ACL IP criada',
    updated: 'ACL IP salva',
    deleted: 'ACL IP excluída',
  },
  restriction: {
    title: 'IP de origem',
    toggle: 'Restringir IP de origem',
    help: 'Requisições de outros endereços recebem 403 (M008).',
    modalTitle: 'IP de origem de {{ name }}',
    lists: 'ACLs IP',
    listsPlaceholder: 'Escolha ACLs IP',
    noLists: 'Nenhuma ACL IP ainda.',
    manage: 'Gerenciar ACLs IP',
    needList: 'Escolha pelo menos uma ACL IP para ligar a restrição.',
    adminOnly: 'Só admins e owners podem mudar isto.',
    off: 'Desligado: qualquer IP de origem é aceito.',
    on: 'Ligado: {{ lists }}',
    saved: 'Restrição de IP de origem salva',
  },
};

export default ptBR;
