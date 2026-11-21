import type en from '../en/ipLists.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  title: 'Listas de prefixos IP',
  metaDescription:
    'Listas de endereços e prefixos IP às quais as chaves de harness podem ser restritas.',
  subtitle:
    'Listas nomeadas de endereços IPv4 e IPv6 ou prefixos CIDR. Cada chave de API de um harness pode ser aceita só a partir dos endereços das listas escolhidas.',
  adminOnly: 'Só admins e owners podem ver e gerenciar listas de prefixos IP.',
  back: '← Listas de prefixos IP',
  create: 'Nova lista',
  list: {
    emptyTitle: 'Nenhuma lista de prefixos IP ainda',
    emptyBody:
      'Crie uma lista e escolha-a para uma chave na aba Chaves de API de um harness, em Restrição de IP de origem.',
    name: 'Nome',
    entries: 'Entradas',
    harnesses: 'Usada por',
    updated: 'Atualizada',
    none: 'Nenhum',
  },
  form: {
    title: 'Lista',
    createTitle: 'Nova lista de prefixos IP',
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
    createSubmit: 'Criar lista',
    errors: {
      name: 'Dê um nome à lista.',
      prefix: 'Não é um endereço IP nem prefixo CIDR.',
      line: 'Linha {{ line }}: {{ prefix }} não é um endereço IP nem prefixo CIDR.',
      tooMany: 'No máximo {{ max }} entradas.',
    },
  },
  usedBy: {
    title: 'Usada por',
    none: 'Nenhuma chave de API usa esta lista.',
  },
  delete: {
    title: 'Excluir lista',
    body: 'Exclui esta lista. As chaves de API que a usam precisam removê-la antes.',
    button: 'Excluir lista',
    confirmTitle: 'Excluir {{ name }}?',
    confirmBody: 'Não dá para desfazer.',
    inUse:
      'Chaves de API destes harnesses ainda usam esta lista. Remova-a da restrição de IP delas antes:',
  },
  toast: {
    created: 'Lista criada',
    updated: 'Lista salva',
    deleted: 'Lista excluída',
  },
  restriction: {
    title: 'IP de origem',
    toggle: 'Restringir IP de origem',
    help: 'Requisições de outros endereços recebem 403 (M008).',
    modalTitle: 'IP de origem de {{ name }}',
    lists: 'Listas de prefixos IP',
    listsPlaceholder: 'Escolha listas',
    noLists: 'Nenhuma lista de prefixos IP ainda.',
    manage: 'Gerenciar listas de prefixos IP',
    needList: 'Escolha pelo menos uma lista para ligar a restrição.',
    adminOnly: 'Só admins e owners podem mudar isto.',
    off: 'Desligado: qualquer IP de origem é aceito.',
    on: 'Ligado: {{ lists }}',
    saved: 'Restrição de IP de origem salva',
  },
};

export default ptBR;
