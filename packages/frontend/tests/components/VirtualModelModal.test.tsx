import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockSetResponseMode = vi.fn();
vi.mock('../../src/services/api/virtual-models.js', () => ({
  createVirtualModel: (...a: unknown[]) => mockCreate(...a),
  updateVirtualModel: (...a: unknown[]) => mockUpdate(...a),
  setVirtualModelResponseMode: (...a: unknown[]) => mockSetResponseMode(...a),
}));

// The picker is exercised in its own tests: here it hands back a fixed model.
let pickerModel = 'deepseek-chat';
vi.mock('../../src/components/ModelPickerModal.js', () => ({
  default: (props: {
    onSelect: (t: string, m: string, p: string, a?: string) => void;
    requiredCapability?: string;
  }) => (
    <div data-testid="picker" data-capability={props.requiredCapability ?? ''}>
      <button onClick={() => props.onSelect('x', pickerModel, 'deepseek', 'api_key')}>pick</button>
    </div>
  ),
}));

import VirtualModelModal from '../../src/components/VirtualModelModal';
import { ApiError } from '../../src/services/api/core';
import type { VirtualModel } from '../../src/services/api/virtual-models';
import type { AvailableModel } from '../../src/services/api';

const model = (model_name: string, provider: string, stream = true): AvailableModel => ({
  model_name,
  provider,
  input_price_per_token: null,
  output_price_per_token: null,
  context_window: 128000,
  capability_reasoning: false,
  capability_code: false,
  capabilities: stream ? ['stream'] : [],
  quality_score: 1,
  display_name: model_name === 'deepseek-chat' ? 'DeepSeek Chat' : null,
});

const models = [
  model('deepseek-chat', 'deepseek'),
  model('gpt-5.5', 'openai'),
  model('old', 'x', false),
];

const existing: VirtualModel = {
  id: 'vm-1',
  agent_id: 'agent-1',
  name: 'claude-sonnet-4-5',
  sort_order: 0,
  enabled: true,
  override_route: { provider: 'anthropic', authType: 'api_key', model: 'claude-sonnet-4-5' },
  fallback_routes: null,
  continue_on_default: false,
  response_mode: 'buffered',
  output_modality: 'text',
  created_at: '',
  updated_at: '',
  shadows: ['claude-sonnet-4-5'],
  context_length: null,
};

function renderModal(extra: Record<string, unknown> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const utils = render(() => (
    <VirtualModelModal
      agentName="demo"
      existing={[existing]}
      models={models}
      customProviders={[]}
      connectedProviders={[]}
      onClose={onClose}
      onSaved={onSaved}
      {...extra}
    />
  ));
  const nameInput = () => screen.getByLabelText('Name') as HTMLInputElement;
  const type = (value: string) => fireEvent.input(nameInput(), { target: { value } });
  return { ...utils, onSaved, onClose, nameInput, type };
}

const pick = (label: string) => {
  fireEvent.click(screen.getByText(label));
  fireEvent.click(screen.getByText('pick'));
};

describe('VirtualModelModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickerModel = 'deepseek-chat';
  });

  it('validates the name live with the shared rule', () => {
    const { type } = renderModal();
    expect(screen.getByText(/Letters, numbers, dots/)).toBeTruthy();
    type('has space');
    expect(screen.getByRole('alert').textContent).toMatch(/can only contain letters/);
    type('/lead');
    expect(screen.getByRole('alert').textContent).toMatch(/cannot start or end with a slash/);
    type('AUTO');
    expect(screen.getByRole('alert').textContent).toMatch(/"auto" is reserved/);
    type('Claude-Sonnet-4-5');
    expect(screen.getByRole('alert').textContent).toMatch(/already uses this name/);
    type('deepseek/flash');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not submit an invalid name', () => {
    renderModal();
    fireEvent.click(screen.getByText('Create virtual model', { selector: 'button' }));
    expect(screen.getByRole('alert').textContent).toBe('Name is required');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('previews the real ids a new name would shadow', () => {
    const { type } = renderModal();
    type('GPT-5.5');
    expect(screen.getByText('This name matches a real model')).toBeTruthy();
    expect(screen.getByText('gpt-5.5', { selector: 'code' })).toBeTruthy();
    type('openai/gpt-5.5');
    expect(screen.getByText('openai/gpt-5.5', { selector: 'code' })).toBeTruthy();
    type('deepseek/flash');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('creates with the chain and the switches', async () => {
    const saved = { ...existing, id: 'vm-2', name: 'deepseek/flash' };
    mockCreate.mockResolvedValue(saved);
    const { type, onSaved } = renderModal();
    type(' deepseek/flash ');
    pick('+ Choose primary model');
    expect(screen.getByText('DeepSeek Chat')).toBeTruthy();
    pickerModel = 'gpt-5.5';
    pick('+ Add fallback (0/5)');
    expect(screen.getByText('Fallback 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Continue on Default' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Stream mode' }));
    fireEvent.click(screen.getByText('Create virtual model', { selector: 'button' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(mockCreate).toHaveBeenCalledWith('demo', {
      name: 'deepseek/flash',
      override_route: { model: 'deepseek-chat', provider: 'deepseek', authType: 'api_key' },
      fallback_routes: [{ model: 'gpt-5.5', provider: 'deepseek', authType: 'api_key' }],
      continue_on_default: true,
      response_mode: 'stream',
    });
  });

  it('removing the primary clears the fallbacks', () => {
    renderModal();
    pick('+ Choose primary model');
    pick('+ Add fallback (0/5)');
    fireEvent.click(screen.getByLabelText('Remove primary deepseek-chat'));
    expect(screen.queryByText('Fallback 1')).toBeNull();
    expect(screen.getByText('+ Choose primary model')).toBeTruthy();
  });

  it('blocks stream mode when a chosen model cannot stream', () => {
    pickerModel = 'old';
    renderModal();
    pick('+ Choose primary model');
    const stream = screen.getByRole('switch', { name: 'Stream mode' }) as HTMLButtonElement;
    expect(stream.disabled).toBe(true);
    expect(screen.getByText(/does not support/)).toBeTruthy();
  });

  it('shows a 409 under the name field', async () => {
    mockCreate.mockRejectedValue(
      new ApiError('A virtual model named "Fresh" already exists on this agent', 409),
    );
    const { type } = renderModal();
    type('Fresh');
    fireEvent.click(screen.getByText('Create virtual model', { selector: 'button' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/already exists on this agent/),
    );
    // Typing again clears the server message.
    type('Fresh2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('highlights the fallback a 400 names', async () => {
    const message =
      'Cannot resolve fallback model "gpt-5.5" to a single connected provider. Pass an explicit (provider, authType, model) route, or connect exactly one provider that offers this model.';
    mockCreate.mockRejectedValue(new ApiError(message, 400));
    const { type, container, onSaved } = renderModal();
    type('deepseek/flash');
    pick('+ Choose primary model');
    pickerModel = 'gpt-5.5';
    pick('+ Add fallback (0/5)');
    fireEvent.click(screen.getByText('Create virtual model', { selector: 'button' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
    const invalid = container.ownerDocument.querySelectorAll(
      '.virtual-model-modal__route--invalid',
    );
    expect(invalid.length).toBe(1);
    expect(invalid[0]!.textContent).toContain('Fallback 1');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edits only what changed and keeps the chain on the card', async () => {
    mockUpdate.mockResolvedValue({ ...existing, continue_on_default: true });
    const { onSaved } = renderModal({ editing: existing, onDelete: vi.fn() });
    expect(screen.getByText('Edit virtual model')).toBeTruthy();
    expect(screen.queryByText('+ Choose primary model')).toBeNull();
    expect(screen.getByText('Shadows a real model')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Continue on Default' }));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith('demo', 'vm-1', { continue_on_default: true });
    expect(mockSetResponseMode).not.toHaveBeenCalled();
  });

  it('changes the response mode on edit through its own endpoint', async () => {
    mockSetResponseMode.mockResolvedValue({ ...existing, response_mode: 'stream' });
    const streamable = {
      ...existing,
      override_route: { ...existing.override_route!, model: 'gpt-5.5' },
    };
    const { onSaved } = renderModal({ editing: streamable });
    fireEvent.click(screen.getByRole('switch', { name: 'Stream mode' }));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetResponseMode).toHaveBeenCalledWith('demo', 'vm-1', 'stream', { silent: true });
  });

  it('keeps a partly saved edit: error inline once, the card gets the rename', async () => {
    const streamable = {
      ...existing,
      override_route: { ...existing.override_route!, model: 'gpt-5.5' },
    };
    const renamed = { ...streamable, name: 'renamed' };
    mockUpdate.mockResolvedValue(renamed);
    mockSetResponseMode.mockRejectedValueOnce(new ApiError('Mode change failed', 400));
    const onPartialSave = vi.fn();
    const { onSaved, type } = renderModal({ editing: streamable, onPartialSave });
    type('renamed');
    fireEvent.click(screen.getByRole('switch', { name: 'Stream mode' }));
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Mode change failed');
    expect(onPartialSave).toHaveBeenCalledWith(renamed);
    expect(onSaved).not.toHaveBeenCalled();
    // Both calls are silent: no toast on top of the inline message.
    expect(mockUpdate).toHaveBeenCalledWith('demo', 'vm-1', { name: 'renamed' });
    expect(mockSetResponseMode).toHaveBeenCalledWith('demo', 'vm-1', 'stream', { silent: true });

    // A retry only sends what is left.
    mockSetResponseMode.mockResolvedValueOnce({ ...renamed, response_mode: 'stream' });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('deletes after confirmation', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderModal({ editing: existing, onDelete });
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('vm-1');
  });

  it('closes on Escape and on Cancel', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
