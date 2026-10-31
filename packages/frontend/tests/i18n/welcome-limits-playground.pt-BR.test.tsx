import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Fragment, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { resetLocaleForTests, setLocale, useLocale } from '../../src/i18n';

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
  getRoutingStatus: vi.fn(() => Promise.resolve({ enabled: false })),
  togglePlaygroundRunStar: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/services/setup-status.js', () => ({
  checkSignupEnabled: () => Promise.resolve(false),
  checkEmailConfigured: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/services/api/triggers.js', () => ({
  listTriggers: vi.fn(() => Promise.resolve([])),
  getHarnessTriggers: vi.fn(() => Promise.resolve([])),
  setHarnessTriggers: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import Limits from '../../src/pages/Limits';
import LimitRuleModal from '../../src/components/LimitRuleModal';
import LimitRuleTable from '../../src/components/LimitRuleTable';
import PlaygroundRecentSidebar from '../../src/components/playground/PlaygroundHistoryDrawer';
import PlaygroundPrompt from '../../src/components/playground/PlaygroundPrompt';
import RequestHeadersPopover from '../../src/components/playground/RequestHeadersPopover';

/** The app remounts its tree on a language change; mirror that here. */
function RemountOnLocale({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return <Fragment key={locale}>{children}</Fragment>;
}

describe('Guardrails and Playground in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
  });

  it('renders the Limits page in Portuguese with localized currency', async () => {
    render(
      <MemoryRouter initialEntries={['/harnesses/test-agent/guardrails']}>
        <Routes>
          <Route path="/harnesses/:agentName/guardrails" element={<Limits />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Regras')).toBeTruthy();
    expect(screen.getByText('Criar regra')).toBeTruthy();
    expect(screen.getByText('Conecte um provedor para definir limites rígidos')).toBeTruthy();
    expect(await screen.findByText('US$ 12,50')).toBeTruthy();
    expect(screen.getByText('por dia')).toBeTruthy();
    expect(screen.getByTitle('Limite rígido')).toBeTruthy();
  });

  it('renders the limit rule modal in Portuguese', () => {
    render(<LimitRuleModal open onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByText('Métrica')).toBeTruthy();
    expect(screen.getByText('Bloquear requisições quando ultrapassar')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Por semana' })).toBeTruthy();
  });

  it('switches language live', () => {
    resetLocaleForTests('en');
    render(
      <RemountOnLocale>
        <LimitRuleTable rules={[]} loading={false} hasProvider onToggleMenu={() => {}} />
      </RemountOnLocale>,
    );
    expect(screen.getByText('No rules yet')).toBeTruthy();
    act(() => setLocale('pt-BR', { persist: false }));
    expect(screen.getByText('Nenhuma regra ainda')).toBeTruthy();
  });

  it('renders the Playground history sidebar and prompt in Portuguese', () => {
    render(
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
      </>,
    );
    expect(screen.getByText('Minhas execuções')).toBeTruthy();
    expect(screen.getByText('Nova execução')).toBeTruthy();
    expect(
      screen.getByText('Nenhuma execução ainda. Envie um prompt para ver seu histórico aqui.'),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText('Envie um prompt para comparar modelos...')).toBeTruthy();
  });

  it('renders request header warnings in Portuguese', () => {
    render(
      <RequestHeadersPopover
        open
        entries={[{ id: 'h1', key: 'Authorization', value: 'x' }]}
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Adicionar header')).toBeTruthy();
    expect(
      screen.getByText('Authorization é reservado pelo Thinker e será descartado.'),
    ).toBeTruthy();
  });
});
