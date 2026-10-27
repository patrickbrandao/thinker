import type en from '../en/welcome.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  pageTitle: 'Boas-vindas - Thinker',
  metaDescription:
    'Conecte seu harness de IA e envie a primeira requisição confiável pelo Thinker.',
  eyebrow: 'Sequência de lançamento · Etapa {{ step }} de {{ total }}',
  steps: {
    harness: 'Criar harness',
    providers: 'Conectar provedores',
    playground: 'Testar modelos',
    route: 'Configurar roteamento',
    activate: 'Conectar o harness e entrar no ar',
  },
  progressLabel: '{{ done }} de {{ total }} etapas da configuração concluídas',
  progressTitle: 'Progresso da configuração',
  skip: 'Pular a configuração por enquanto',
  restoring: 'Restaurando sua configuração…',
  failedCreate: 'Não foi possível criar o harness',
  harness: {
    title: 'Crie seu primeiro harness',
    desc: 'Um harness representa o agente ou a aplicação cujas requisições o Thinker vai rotear, corrigir e observar.',
    type: 'Tipo',
    name: 'Nome do harness',
    namePlaceholder: 'ex.: Meu Harness',
    settings: 'Configurações',
    enableLogs: 'Ativar logs',
    enableLogsHint:
      'Veja exatamente o que seu agente envia em cada tentativa e depure mais rápido. Os logs ficam no seu próprio banco de dados.',
    create: 'Criar harness',
  },
  providers: {
    title: 'Conectar provedores',
    desc: '{{ name }} roteia requisições entre os provedores que você conectar. Comece com um e depois adicione mais dois provedores independentes para ter cobertura completa de fallback.',
    yourHarness: 'Seu harness',
    usageBased: 'Por uso',
    subscriptions: 'Assinaturas',
    local: 'Local',
    loading: 'Carregando provedores…',
    connect: 'Conectar',
    connected: 'Conectado',
    loadError: 'Não foi possível carregar seus provedores. Atualize a página e tente de novo.',
    needOne: 'Conecte pelo menos um provedor para continuar.',
    testLater: 'Testar modelos depois',
    connectedCount: (n: number) =>
      n === 1 ? '1 provedor conectado.' : `${n} provedores conectados.`,
    testModels: 'Testar modelos',
  },
  playground: {
    title: 'Teste seus modelos',
    desc: 'Compare como seus modelos disponíveis lidam com um prompt representativo sem sair da configuração inicial.',
    backToProviders: 'Voltar para provedores',
    optional: 'Esta etapa é opcional.',
    continueToRouting: 'Continuar para o roteamento',
  },
  route: {
    title: 'Configure o roteamento padrão',
    loading: 'Carregando roteamento…',
    backToTest: 'Voltar para o teste de modelos',
    continue: 'Continuar',
  },
  activate: {
    title: 'Conecte seu harness e entre no ar',
    desc: 'Aponte {{ name }} para o Thinker com as instruções abaixo e envie uma mensagem. Detectamos a primeira requisição bem-sucedida automaticamente.',
    yourAgent: 'seu agente',
    instructionsLabel: 'Instruções de configuração do harness',
    onceConfigured:
      'Depois de configurar, envie uma mensagem pelo seu agente. O Thinker detecta a primeira requisição bem-sucedida automaticamente.',
    waitingTitle: 'Aguardando a primeira requisição do seu agente',
    waitingDesc:
      'Deixe esta página aberta e envie uma mensagem pelo seu agente. Verificamos a cada poucos segundos.',
    checking: 'Verificando…',
    checkAgain: 'Verificar de novo',
    checkError:
      'Não conseguimos verificar uma requisição agora. Confirme que seu agente consegue acessar o Thinker e tente de novo.',
    waitedLong:
      'Nada ainda? A maioria dos agentes precisa ser reiniciada depois de mudar a configuração para usar o novo endpoint.',
    failedTitle: 'Recebemos a requisição, mas ela falhou.',
    failedStatus:
      'O Thinker registrou o status “{{ status }}”. Corrija o problema e envie outra mensagem.',
    whatDoesMean: 'O que significa {{ code }}?',
    liveTitle: 'Seu harness está no ar.',
    liveDesc: 'O Thinker roteou com sucesso a primeira requisição real',
    liveTo: 'para {{ model }}',
    liveIn: 'em {{ ms }} ms',
    backToRouting: 'Voltar para o roteamento',
    goToDashboard: 'Ir para o painel',
  },
  liftoff: {
    kicker: 'Configuração inicial concluída',
    launch: 'Decolagem',
    orbit: 'Órbita alcançada',
    description: 'A primeira requisição do seu agente acabou de chegar.',
    routedTo: 'Roteada para {{ model }}',
    in: 'em {{ ms }} ms',
    agent: 'agente',
    live: '{{ name }} · no ar',
    goToDashboard: 'Ir para o painel',
  },
};

export default ptBR;
