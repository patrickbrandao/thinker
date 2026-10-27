import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { resetLocaleForTests, setLocale } from '../../src/i18n';
import { PROVIDERS } from '../../src/services/providers';
import type { AuthType } from '../../src/services/api';

vi.mock('../../src/services/api.js', () => ({
  connectProvider: vi.fn().mockResolvedValue({}),
  disconnectProvider: vi.fn().mockResolvedValue({}),
  revokeOpenaiOAuth: vi.fn().mockResolvedValue(undefined),
  renameProviderKey: vi.fn().mockResolvedValue({}),
  reorderProviderKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

import ProviderKeyForm from '../../src/components/ProviderKeyForm';
import ProviderSubscriptionTab from '../../src/components/ProviderSubscriptionTab';

const provDef = (id: string) => PROVIDERS.find((p) => p.id === id)!;

function renderKeyForm(id: string) {
  const [busy, setBusy] = createSignal(false);
  const [keyInput, setKeyInput] = createSignal('');
  const [editing, setEditing] = createSignal(false);
  const [validationError, setValidationError] = createSignal<string | null>(null);
  return render(() => (
    <ProviderKeyForm
      provDef={provDef(id)}
      provId={id}
      agentName="demo"
      isSubMode={() => false}
      connected={() => false}
      selectedAuthType={() => 'api_key' as AuthType}
      busy={busy}
      setBusy={setBusy}
      keyInput={keyInput}
      setKeyInput={setKeyInput}
      editing={editing}
      setEditing={setEditing}
      validationError={validationError}
      setValidationError={setValidationError}
      getKeyPrefixDisplay={() => ''}
      providers={[]}
      onBack={vi.fn()}
      onUpdate={vi.fn()}
    />
  ));
}

describe('provider setup in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
  });

  it('renders the API key form in Portuguese, with translated validation', () => {
    renderKeyForm('openai');
    expect(screen.getByText('Chave de API')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeDefined();
    expect(screen.getByLabelText('OpenAI: chave de API')).toBeDefined();
    expect(screen.getByText('Obter chave de API de OpenAI')).toBeDefined();

    const input = screen.getByLabelText('OpenAI: chave de API') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'nope' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('As chaves do OpenAI começam com "sk-"')).toBeDefined();
  });

  it('translates region labels of the provider catalog', () => {
    renderKeyForm('qwen');
    expect(screen.getByText('Região')).toBeDefined();
    expect(screen.getByRole('option', { name: 'Detectar automaticamente' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Japão (Tóquio)' })).toBeDefined();
  });

  it('renders the subscription tab and switches language live', () => {
    const { container } = render(() => (
      <ProviderSubscriptionTab
        busy={() => false}
        isSubscriptionConnected={() => false}
        isSubscriptionWithToken={() => false}
        onOpenDetail={vi.fn()}
        onAddKey={vi.fn()}
        onToggle={vi.fn()}
        subscriptionProviders={[provDef('anthropic'), provDef('kiro')]}
      />
    ));
    expect(container.textContent).toContain('Use a assinatura ou o plano pago');
    expect(screen.getByText('Assinatura Claude Max / Pro')).toBeDefined();
    expect(screen.getByText('Assinatura Kiro')).toBeDefined();
    expect(screen.getByText('Guia de provedores por assinatura')).toBeDefined();

    setLocale('en', { persist: false });
    expect(screen.getByText('Claude Max / Pro subscription')).toBeDefined();
    expect(screen.getByText('Subscription provider guide')).toBeDefined();
  });
});
