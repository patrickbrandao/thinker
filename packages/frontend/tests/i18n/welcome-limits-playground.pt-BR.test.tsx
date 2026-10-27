import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { resetLocaleForTests, setLocale } from '../../src/i18n';

vi.mock('@solidjs/router', () => ({
  useParams: () => ({ agentName: 'test-agent' }),
  A: (props: any) => <a href={props.href}>{props.children}</a>,
}));

vi.mock('@solidjs/meta', () => ({
  Title: (props: any) => <title>{props.children}</title>,
  Meta: () => null,
}));

const rule = {
  id: 'r1',
  agent_name: 'test-agent',
  metric_type: 'cost',
  threshold: 12.5,
  period: 'day',
  action: 'both',
  is_active: true,
  trigger_count: 0,
};

vi.mock('../../src/services/api.js', () => ({
  getNotificationRules: vi.fn(() => Promise.resolve([rule])),
  getNotificationLogs: vi.fn(() => Promise.resolve([])),
  createNotificationRule: vi.fn(() => Promise.resolve({})),
  updateNotificationRule: vi.fn(() => Promise.resolve({})),
  deleteNotificationRule: vi.fn(() => Promise.resolve({})),
  getEmailProvider: vi.fn(() => Promise.resolve(null)),
  removeEmailProvider: vi.fn(() => Promise.resolve({})),
  getRoutingStatus: vi.fn(() => Promise.resolve({ enabled: false })),
  togglePlaygroundRunStar: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkSignupEnabled: () => Promise.resolve(false),
  checkEmailConfigured: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/components/EmailProviderSection.js', () => ({ default: () => null }));
vi.mock('../../src/components/EmailProviderModal.js', () => ({ default: () => null }));
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import Limits from '../../src/pages/Limits';
import LimitRuleModal from '../../src/components/LimitRuleModal';
import LimitRuleTable from '../../src/components/LimitRuleTable';
import PlaygroundRecentSidebar from '../../src/components/playground/PlaygroundHistoryDrawer';
import PlaygroundPrompt from '../../src/components/playground/PlaygroundPrompt';
import RequestHeadersPopover from '../../src/components/playground/RequestHeadersPopover';

describe('Guardrails and Playground in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
  });

  it('renders the Limits page in Portuguese with localized currency', async () => {
    render(() => <Limits />);
    expect(await screen.findByText('Regras')).toBeDefined();
    expect(screen.getByText('Criar regra')).toBeDefined();
    expect(screen.getByText('Conecte um provedor para definir limites rígidos')).toBeDefined();
    expect(await screen.findByText('US$ 12,50')).toBeDefined();
    expect(screen.getByText('por dia')).toBeDefined();
    expect(screen.getByTitle('Limite rígido')).toBeDefined();
  });

  it('renders the limit rule modal in Portuguese', () => {
    render(() => <LimitRuleModal open onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByText('Métrica')).toBeDefined();
    expect(screen.getByText('Bloquear requisições quando ultrapassar')).toBeDefined();
    expect(screen.getByRole('option', { name: 'Por semana' })).toBeDefined();
  });

  it('switches language live', () => {
    resetLocaleForTests('en');
    render(() => (
      <LimitRuleTable rules={[]} loading={false} hasProvider onToggleMenu={() => {}} />
    ));
    expect(screen.getByText('No rules yet')).toBeDefined();
    setLocale('pt-BR', { persist: false });
    expect(screen.getByText('Nenhuma regra ainda')).toBeDefined();
  });

  it('renders the Playground history sidebar and prompt in Portuguese', () => {
    render(() => (
      <>
        <PlaygroundRecentSidebar
          open
          loading={false}
          runs={[]}
          activeRunId={null}
          onToggle={() => {}}
          onSelect={() => {}}
        />
        <PlaygroundPrompt
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          onRecallPrevious={() => {}}
          disabled={false}
          running={false}
        />
      </>
    ));
    expect(screen.getByText('Minhas execuções')).toBeDefined();
    expect(screen.getByText('Nova execução')).toBeDefined();
    expect(
      screen.getByText('Nenhuma execução ainda. Envie um prompt para ver seu histórico aqui.'),
    ).toBeDefined();
    expect(screen.getByPlaceholderText('Envie um prompt para comparar modelos...')).toBeDefined();
  });

  it('renders request header warnings in Portuguese', () => {
    render(() => (
      <RequestHeadersPopover
        open
        entries={[{ id: 'h1', key: 'Authorization', value: 'x' }]}
        onChange={() => {}}
        onClose={() => {}}
      />
    ));
    expect(screen.getByText('Adicionar header')).toBeDefined();
    expect(
      screen.getByText('Authorization é reservado pelo Thinker e será descartado.'),
    ).toBeDefined();
  });
});
