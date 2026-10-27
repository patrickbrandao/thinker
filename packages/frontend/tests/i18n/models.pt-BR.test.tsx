import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';

vi.mock('@solidjs/router', () => ({
  useParams: () => ({}),
}));

vi.mock('@solidjs/meta', () => ({
  Title: (props: any) => <title>{props.children}</title>,
  Meta: (props: any) => <meta name={props.name ?? ''} content={props.content ?? ''} />,
}));

const mockGetModelPrices = vi.fn();
vi.mock('../../src/services/api.js', () => ({
  getModelPrices: () => mockGetModelPrices(),
}));

vi.mock('../../src/services/model-display.js', () => ({
  getModelDisplayName: (slug: string) => slug,
  preloadModelDisplayNames: () => {},
}));

vi.mock('../../src/components/ProviderIcon.jsx', () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/services/api/virtual-models.js', () => ({
  createVirtualModel: vi.fn(),
  updateVirtualModel: vi.fn(),
  setVirtualModelResponseMode: vi.fn(),
}));

vi.mock('../../src/components/ModelPickerModal.js', () => ({
  default: () => <div data-testid="picker" />,
}));

import ModelPrices from '../../src/pages/ModelPrices';
import VirtualModelModal from '../../src/components/VirtualModelModal';
import { resetLocaleForTests } from '../../src/i18n';

describe('model screens in pt-BR', () => {
  beforeEach(() => {
    resetLocaleForTests('pt-BR');
    mockGetModelPrices.mockResolvedValue({
      models: [
        {
          model_name: 'gpt-4o-mini',
          provider: 'OpenAI',
          input_price_per_million: 0.15,
          output_price_per_million: 0.6,
        },
      ],
      lastSyncedAt: '2026-02-18T10:00:00Z',
    });
  });

  it('renders the Model Prices page in Portuguese with pt-BR currency', async () => {
    const { container } = render(() => <ModelPrices />);
    expect(await screen.findByText('Preços de modelos')).toBeDefined();
    expect(screen.getByText('ID do modelo')).toBeDefined();
    expect(screen.getByText('Custo de envio / 1M tokens')).toBeDefined();
    expect(screen.getByText('1 modelos')).toBeDefined();
    expect(screen.getByText(/Última atualização:/)).toBeDefined();
    // Intl separates the symbol with a no-break space.
    expect(container.textContent).toMatch(/US\$\s0,150/);
    const search = container.querySelector<HTMLInputElement>('.model-filter__search')!;
    expect(search.placeholder).toBe('Buscar modelos ou provedores...');
  });

  it('renders the virtual model modal in Portuguese', async () => {
    render(() => (
      <VirtualModelModal
        agentName="demo"
        existing={[]}
        models={[]}
        customProviders={[]}
        connectedProviders={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    ));
    expect(screen.getByRole('heading', { name: 'Criar modelo virtual' })).toBeDefined();
    expect(screen.getByLabelText('Nome')).toBeDefined();
    expect(screen.getByText('+ Escolher modelo principal')).toBeDefined();
    expect(screen.getByText('Continuar no Padrão')).toBeDefined();
    expect(screen.getByText('Cancelar')).toBeDefined();
    fireEvent.input(screen.getByLabelText('Nome'), { target: { value: 'auto' } });
    expect(screen.getByRole('switch', { name: 'Modo stream' })).toBeDefined();
  });
});
