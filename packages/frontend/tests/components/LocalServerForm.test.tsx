import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDefaults = vi.fn();
const mockProbe = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/services/api.js', () => ({
  getLocalServerDefaults: (...a: unknown[]) => mockDefaults(...a),
  probeLocalServer: (...a: unknown[]) => mockProbe(...a),
  createCustomProvider: (...a: unknown[]) => mockCreate(...a),
  updateCustomProvider: (...a: unknown[]) => mockUpdate(...a),
  deleteCustomProvider: (...a: unknown[]) => mockDelete(...a),
}));

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../src/services/toast-store.js', () => ({ toast: mockToast }));
vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: (id: string) => <span data-testid={'icon-' + id} />,
}));

import LocalServerForm, { LOCAL_SERVER_TYPE_NAMES } from '../../src/components/LocalServerForm';
import type { CustomProviderData } from '../../src/services/api';
import { resetLocaleForTests } from '../../src/i18n';

const defaultsFor = (type: string, port: number, env: string) => ({
  type,
  display_name: type,
  env,
  default_port: port,
  config: {
    scheme: 'http',
    host: 'host.docker.internal',
    port,
    path_prefix: '',
    request_timeout_ms: 120000,
    probe_timeout_ms: 5000,
  },
});

const ALL_DEFAULTS = [
  defaultsFor('ollama', 11434, 'OLLAMA_HOST'),
  defaultsFor('lmstudio', 1234, 'THINKER_LMSTUDIO_BASE_URL'),
  defaultsFor('llamacpp', 9931, 'THINKER_LLAMACPP_BASE_URL'),
];

const edit: CustomProviderData = {
  id: 'cp-9',
  name: 'Office GPU',
  alias: null,
  base_url: 'http://10.0.0.5:11434/v1',
  api_kind: 'openai',
  local_type: 'ollama',
  local_config: {
    scheme: 'http',
    host: '10.0.0.5',
    port: 11434,
    path_prefix: '',
    request_timeout_ms: 90000,
    probe_timeout_ms: 4000,
  },
  has_api_key: true,
  models: [{ model_name: 'llama3', context_window: 8192, capabilities: ['tools'] }],
  created_at: '',
};

const handlers = () => ({ onSaved: vi.fn(), onCancel: vi.fn(), onDeleted: vi.fn() });

async function renderNew(
  over: Partial<React.ComponentProps<typeof LocalServerForm>> = {},
  type: 'ollama' | 'lmstudio' | 'llamacpp' = 'ollama',
  nameLabel = 'Name',
) {
  const h = handlers();
  const utils = render(<LocalServerForm agentName="demo" type={type} {...h} {...over} />);
  await screen.findByLabelText(nameLabel);
  return { ...utils, ...h };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const clickTest = () => fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
const clickConnect = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Connect \d+ model/ }));

beforeEach(() => {
  vi.clearAllMocks();
  mockDefaults.mockResolvedValue(ALL_DEFAULTS);
  mockProbe.mockResolvedValue({
    version: '0.6.1',
    base_url: 'http://host.docker.internal:11434',
    models: [
      {
        model_name: 'llama3',
        context_window: 8192,
        capabilities: ['tools', 'vision'],
        loaded: true,
      },
      { model_name: 'qwen', loaded: false },
    ],
  });
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
});

describe('LOCAL_SERVER_TYPE_NAMES', () => {
  it('names each runtime', () => {
    expect(LOCAL_SERVER_TYPE_NAMES).toEqual({
      ollama: 'Ollama',
      lmstudio: 'LM Studio',
      llamacpp: 'llama.cpp',
    });
  });
});

describe('LocalServerForm defaults', () => {
  it('shows a loading state until the defaults arrive', async () => {
    let resolve!: (v: unknown) => void;
    mockDefaults.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<LocalServerForm agentName="demo" type="ollama" {...handlers()} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
    resolve(ALL_DEFAULTS);
    expect(await screen.findByLabelText('Name')).toBeTruthy();
  });

  it('pre-fills every field from the type defaults (timeouts in seconds)', async () => {
    await renderNew();
    expect(field('Name').value).toBe('Ollama');
    expect(field('Host').value).toBe('host.docker.internal');
    expect(field('Port').value).toBe('11434');
    expect(field('Scheme').value).toBe('http');
    expect(field('Path prefix').value).toBe('');
    expect(field('Request timeout (s)').value).toBe('120');
    expect(field('Test timeout (s)').value).toBe('5');
    expect(screen.getByText('Add Ollama server')).toBeTruthy();
    expect(screen.getByText(/port 11434, host from OLLAMA_HOST/)).toBeTruthy();
    expect(mockDefaults).toHaveBeenCalledWith('demo');
  });

  it('uses the defaults of the requested type', async () => {
    await renderNew({}, 'llamacpp');
    expect(field('Name').value).toBe('llama.cpp');
    expect(field('Port').value).toBe('9931');
    expect(screen.getByText(/--api-prefix/)).toBeTruthy();
  });

  it('picks a free name when the default is taken, case-insensitively', async () => {
    await renderNew({ takenNames: ['ollama', 'Ollama 2'] });
    expect(field('Name').value).toBe('Ollama 3');
  });

  it('keeps the plain default name when only other names are taken', async () => {
    await renderNew({ takenNames: ['LM Studio'] });
    expect(field('Name').value).toBe('Ollama');
  });

  it('hides the title row when embedded but keeps the defaults hint', async () => {
    await renderNew({ embedded: true });
    expect(screen.queryByText('Add Ollama server')).toBeNull();
    expect(screen.getByText(/port 11434/)).toBeTruthy();
  });

  it('stays on the spinner when the type has no defaults', async () => {
    mockDefaults.mockResolvedValue([defaultsFor('lmstudio', 1234, 'X')]);
    render(<LocalServerForm agentName="demo" type="ollama" {...handlers()} />);
    await waitFor(() => expect(mockDefaults).toHaveBeenCalled());
    expect(screen.getByText('Loading...')).toBeTruthy();
  });
});

describe('LocalServerForm validation', () => {
  it.each([
    ['name', 'Name', '   ', 'Enter a name.'],
    ['host', 'Host', '  ', 'Enter a host.'],
    ['port zero', 'Port', '0', 'Port must be between 1 and 65535.'],
    ['port too high', 'Port', '65536', 'Port must be between 1 and 65535.'],
    ['port fractional', 'Port', '80.5', 'Port must be between 1 and 65535.'],
    ['port empty', 'Port', '', 'Port must be between 1 and 65535.'],
    [
      'request timeout zero',
      'Request timeout (s)',
      '0',
      'Timeouts must be between 1 and 3600 seconds.',
    ],
    [
      'probe timeout too high',
      'Test timeout (s)',
      '3601',
      'Timeouts must be between 1 and 3600 seconds.',
    ],
  ])('rejects an invalid %s before calling the server', async (_n, label, value, message) => {
    await renderNew();
    fireEvent.change(field(label), { target: { value } });
    // submit() skips the browser's native min/max check, which would stop the click first.
    fireEvent.submit(field('Host').closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('accepts the boundary values', async () => {
    await renderNew();
    fireEvent.change(field('Port'), { target: { value: '65535' } });
    fireEvent.change(field('Request timeout (s)'), { target: { value: '3600' } });
    fireEvent.change(field('Test timeout (s)'), { target: { value: '1' } });
    clickTest();
    await waitFor(() => expect(mockProbe).toHaveBeenCalled());
  });
});

describe('LocalServerForm connection test', () => {
  it('sends the typed config (trimmed, in ms) and the key only when typed', async () => {
    await renderNew();
    fireEvent.change(field('Host'), { target: { value: '  192.168.1.20 ' } });
    fireEvent.change(field('Scheme'), { target: { value: 'https' } });
    fireEvent.change(field('Port'), { target: { value: '8443' } });
    fireEvent.change(field('Path prefix'), { target: { value: ' /ollama ' } });
    fireEvent.change(field('Request timeout (s)'), { target: { value: '30' } });
    fireEvent.change(field('Test timeout (s)'), { target: { value: '2' } });
    clickTest();
    await screen.findByText(/Reachable at/);
    expect(mockProbe).toHaveBeenCalledWith('demo', {
      local_type: 'ollama',
      local_config: {
        scheme: 'https',
        host: '192.168.1.20',
        port: 8443,
        path_prefix: '/ollama',
        request_timeout_ms: 30000,
        probe_timeout_ms: 2000,
      },
    });

    fireEvent.change(field('API key (optional)'), { target: { value: 'sekret' } });
    clickTest();
    await waitFor(() => expect(mockProbe).toHaveBeenCalledTimes(2));
    expect(mockProbe.mock.calls[1][1].apiKey).toBe('sekret');
  });

  it('shows reachability with the server version and the models it reports', async () => {
    await renderNew();
    clickTest();
    expect(
      await screen.findByText('Reachable at http://host.docker.internal:11434 (version 0.6.1)'),
    ).toBeTruthy();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(screen.getByText('llama3')).toBeTruthy();
    expect(screen.getByText('8,192 ctx')).toBeTruthy();
    expect(screen.getByText('Loaded')).toBeTruthy();
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('Vision')).toBeTruthy();
  });

  it('omits the version when the server does not report one', async () => {
    mockProbe.mockResolvedValue({ base_url: 'http://h:1', models: [{ model_name: 'm' }] });
    await renderNew();
    clickTest();
    expect(await screen.findByText('Reachable at http://h:1')).toBeTruthy();
  });

  it('starts with only the loaded models selected, and everything when none is loaded', async () => {
    await renderNew();
    clickTest();
    await screen.findAllByRole('switch');
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
    ]);
    expect(screen.getByRole('button', { name: 'Connect 1 model' })).toBeTruthy();
  });

  it('selects every model when none is reported as loaded', async () => {
    mockProbe.mockResolvedValue({
      base_url: 'http://h:1',
      models: [{ model_name: 'a' }, { model_name: 'b' }],
    });
    await renderNew();
    clickTest();
    await screen.findAllByRole('switch');
    expect(screen.getByRole('button', { name: 'Connect 2 models' })).toBeTruthy();
  });

  it('shows the failure and clears a previous result when the test fails', async () => {
    await renderNew();
    clickTest();
    await screen.findByText(/Reachable at/);
    mockProbe.mockRejectedValue(new Error('connect ECONNREFUSED'));
    fireEvent.change(field('Port'), { target: { value: '1' } });
    clickTest();
    expect((await screen.findByRole('alert')).textContent).toContain('connect ECONNREFUSED');
    expect(screen.queryByText(/Reachable at/)).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    mockProbe.mockRejectedValue('nope');
    await renderNew();
    clickTest();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
  });

  it('explains when the server runs but has no model loaded', async () => {
    mockProbe.mockResolvedValue({ base_url: 'http://h:1', models: [] });
    await renderNew();
    clickTest();
    expect(await screen.findByText(/no models are loaded/)).toBeTruthy();
    expect(screen.getByText(/Open Ollama and load a model/)).toBeTruthy();
  });

  it('invalidates the test when a connection setting changes, but not when only the name does', async () => {
    await renderNew();
    clickTest();
    await screen.findByText(/Reachable at/);
    fireEvent.change(field('Name'), { target: { value: 'Renamed' } });
    expect(screen.getByText(/Reachable at/)).toBeTruthy();
    fireEvent.change(field('Host'), { target: { value: 'other' } });
    expect(screen.queryByText(/Reachable at/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: /^Connect \d+ model/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('submitting the form with Enter runs the test', async () => {
    await renderNew();
    fireEvent.submit(field('Host').closest('form')!);
    await waitFor(() => expect(mockProbe).toHaveBeenCalledTimes(1));
  });
});

describe('LocalServerForm creating', () => {
  it('cannot connect before a successful test', async () => {
    await renderNew();
    expect(
      (screen.getByRole('button', { name: /^Connect \d+ model/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('toggles models and disables Connect when none is selected', async () => {
    await renderNew();
    clickTest();
    await screen.findAllByRole('switch');
    const [first, second] = screen.getAllByRole('switch');
    fireEvent.click(second);
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Connect 2 models' })).toBeTruthy();
    fireEvent.click(first);
    fireEvent.click(second);
    expect(
      (screen.getByRole('button', { name: /^Connect 0 models/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('creates the server with zero prices and the reported context window and capabilities', async () => {
    const { onSaved } = await renderNew();
    fireEvent.change(field('Name'), { target: { value: '  My Ollama ' } });
    clickTest();
    await screen.findAllByRole('switch');
    fireEvent.click(screen.getAllByRole('switch')[1]);
    clickConnect();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith('demo', {
      name: 'My Ollama',
      local_type: 'ollama',
      local_config: expect.objectContaining({ host: 'host.docker.internal', port: 11434 }),
      models: [
        {
          model_name: 'llama3',
          input_price_per_million_tokens: 0,
          output_price_per_million_tokens: 0,
          context_window: 8192,
          capabilities: ['tools', 'vision'],
        },
        {
          model_name: 'qwen',
          input_price_per_million_tokens: 0,
          output_price_per_million_tokens: 0,
        },
      ],
    });
    expect(mockToast.success).toHaveBeenCalledWith('My Ollama connected (2 models)');
  });

  it('reports a creation failure inline and does not close', async () => {
    mockCreate.mockRejectedValue(new Error('Name already in use'));
    const { onSaved } = await renderNew();
    clickTest();
    await screen.findAllByRole('switch');
    clickConnect();
    expect((await screen.findByRole('alert')).textContent).toContain('Name already in use');
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('does not create when the name was blanked after the test', async () => {
    await renderNew();
    clickTest();
    await screen.findAllByRole('switch');
    fireEvent.change(field('Name'), { target: { value: '' } });
    clickConnect();
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a name.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('cancel calls onCancel', async () => {
    const { onCancel } = await renderNew();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('has no Remove button when creating', async () => {
    await renderNew();
    expect(screen.queryByRole('button', { name: 'Remove server' })).toBeNull();
  });
});

describe('LocalServerForm editing', () => {
  it('pre-fills from the stored config without waiting for a test, and lists the stored models', async () => {
    await renderNew({ editData: edit });
    expect(field('Name').value).toBe('Office GPU');
    expect(field('Host').value).toBe('10.0.0.5');
    expect(field('Request timeout (s)').value).toBe('90');
    expect(field('Test timeout (s)').value).toBe('4');
    expect(screen.getByText('Edit Ollama server')).toBeTruthy();
    expect(screen.getByText('A key is stored. Leave empty to keep it.')).toBeTruthy();
    expect(screen.getByText('llama3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit model llama3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove model llama3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('sends provider_id with the test so the stored key can be reused', async () => {
    await renderNew({ editData: edit });
    clickTest();
    await waitFor(() => expect(mockProbe).toHaveBeenCalled());
    expect(mockProbe.mock.calls[0][1].provider_id).toBe('cp-9');
    expect(mockProbe.mock.calls[0][1].apiKey).toBeUndefined();
  });

  it('keeps its models after a test and offers the new ones the server reports', async () => {
    mockProbe.mockResolvedValue({
      base_url: 'http://h:1',
      models: [{ model_name: 'new-model', loaded: true, context_window: 4096 }],
    });
    const { onSaved } = await renderNew({ editData: edit });
    clickTest();
    await screen.findByText('new-model');
    expect(screen.getByText('llama3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Remove model new-model' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][2].models.map((m: any) => m.model_name)).toEqual([
      'llama3',
      'new-model',
    ]);
    expect(mockUpdate.mock.calls[0][2].models[1].context_window).toBe(4096);
  });

  it('adds, edits and removes models by hand', async () => {
    const { onSaved } = await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter the model name.');
    fireEvent.change(field('Model name'), { target: { value: 'llama3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('already listed');
    fireEvent.change(field('Model name'), { target: { value: 'qwen3:8b' } });
    fireEvent.change(field('Context window (tokens)'), { target: { value: '32768' } });
    fireEvent.click(screen.getByLabelText('Vision'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    // Edit llama3: drop its context window.
    fireEvent.click(screen.getByRole('button', { name: 'Edit model llama3' }));
    fireEvent.change(field('Context window (tokens)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove model llama3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][2].models).toEqual([
      {
        model_name: 'qwen3:8b',
        context_window: 32768,
        capabilities: ['vision'],
        input_price_per_million_tokens: 0,
        output_price_per_million_tokens: 0,
      },
    ]);
  });

  it('cannot save once every model is removed', async () => {
    await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Remove model llama3' }));
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('removes the stored key and tests without it', async () => {
    const { onSaved } = await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(screen.getByText(/stored key is removed on save/)).toBeTruthy();
    clickTest();
    await waitFor(() => expect(mockProbe).toHaveBeenCalled());
    expect(mockProbe.mock.calls[0][1].provider_id).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][2].apiKey).toBeNull();
  });

  it('saves without re-testing, sending the stored models, and omits an unchanged name and empty key', async () => {
    const { onSaved } = await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith('demo', 'cp-9', {
      local_config: expect.objectContaining({
        host: '10.0.0.5',
        request_timeout_ms: 90000,
        probe_timeout_ms: 4000,
      }),
      models: [
        {
          model_name: 'llama3',
          input_price_per_million_tokens: 0,
          output_price_per_million_tokens: 0,
          context_window: 8192,
          capabilities: ['tools'],
        },
      ],
    });
    expect(mockToast.success).toHaveBeenCalledWith('Office GPU updated (1 model)');
  });

  it('sends a new name and key only when they changed', async () => {
    const { onSaved } = await renderNew({ editData: edit });
    fireEvent.change(field('Name'), { target: { value: ' Lab GPU ' } });
    fireEvent.change(field('API key (optional)'), { target: { value: 'newkey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = mockUpdate.mock.calls[0][2];
    expect(body.name).toBe('Lab GPU');
    expect(body.apiKey).toBe('newkey');
  });

  it('shows the update error inline', async () => {
    mockUpdate.mockRejectedValue(new Error('conflict'));
    const { onSaved } = await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('conflict');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('removes the server, toasts and calls onDeleted', async () => {
    const { onDeleted, onSaved } = await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Remove server' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(mockDelete).toHaveBeenCalledWith('demo', 'cp-9');
    expect(mockToast.success).toHaveBeenCalledWith('Office GPU disconnected');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('falls back to onSaved after removing when no onDeleted is given', async () => {
    const onSaved = vi.fn();
    render(
      <LocalServerForm
        agentName="demo"
        type="ollama"
        editData={edit}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove server' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('toasts an error when removal fails and stays open', async () => {
    mockDelete.mockRejectedValue(new Error('in use by a route'));
    const { onDeleted } = await renderNew({ editData: edit });
    fireEvent.click(screen.getByRole('button', { name: 'Remove server' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('in use by a route'));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('LocalServerForm in pt-BR', () => {
  it('translates labels, validation and the title', async () => {
    resetLocaleForTests('pt-BR');
    await renderNew({}, 'ollama', 'Nome');
    expect(screen.getByLabelText('Nome')).toBeTruthy();
    expect(screen.getByText('Adicionar servidor Ollama')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Testar conex/ }));
    expect((await screen.findByRole('alert')).textContent).not.toContain('Enter a name.');
    expect(mockProbe).not.toHaveBeenCalled();
  });
});
