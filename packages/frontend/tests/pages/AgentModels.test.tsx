import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockList = vi.fn();
vi.mock('../../src/services/api/virtual-models.js', () => ({
  getHarnessModelList: (...a: unknown[]) => mockList(...a),
}));
vi.mock('../../src/services/toast-store.js', () => ({ toast: { error: vi.fn() } }));
vi.mock('../../src/services/agent-display-name.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return { agentDisplayNameSignal: signal('Demo'), agentDisplayName: () => 'Demo' };
});

import AgentModels from '../../src/pages/AgentModels';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/harnesses/demo/models']}>
      <Routes>
        <Route path="/harnesses/:agentName/models" element={<AgentModels />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AgentModels', () => {
  it('lists auto, the virtual models and the real models with their details', async () => {
    mockList.mockResolvedValue({
      listing: 'restricted',
      data: [
        { id: 'auto', kind: 'auto', owned_by: 'thinker', context_length: 64000 },
        {
          id: 'deepseek',
          kind: 'virtual',
          owned_by: 'thinker',
          context_length: null,
          primary: { provider: 'deepseek', model: 'deepseek-chat' },
          fallbacks: [{ provider: 'openai', model: 'gpt-5.5' }],
          continue_on_default: true,
          response_mode: 'stream',
        },
        {
          id: 'openai/gpt-5.5',
          kind: 'model',
          owned_by: 'openai',
          context_length: 400000,
          display_name: 'GPT-5.5',
          provider_model_id: 'gpt-5.5',
          auth_type: 'api_key',
          input_price_per_token: 0.000002,
          output_price_per_token: 0.00001,
          reasoning: true,
        },
      ],
    });
    renderPage();
    expect(await screen.findByText('openai/gpt-5.5')).toBeTruthy();
    expect(mockList).toHaveBeenCalledWith('demo');
    expect(screen.getByText('auto')).toBeTruthy();
    expect(screen.getByText('deepseek')).toBeTruthy();
    expect(screen.getByText('GPT-5.5')).toBeTruthy();
    expect(screen.getByText('3 models')).toBeTruthy();
    expect(screen.getByText(/Listing: Restricted/)).toBeTruthy();
    expect(
      screen.getByText('Primary: deepseek-chat · 1 fallback · continues on auto · stream'),
    ).toBeTruthy();
    expect(screen.getByText('reasoning')).toBeTruthy();
    expect(screen.getByText('$2.00')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter models'), { target: { value: 'gpt' } });
    expect(screen.queryByText('deepseek')).toBeNull();
    expect(screen.getByText('openai/gpt-5.5')).toBeTruthy();
  });
});
