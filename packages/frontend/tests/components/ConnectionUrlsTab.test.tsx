import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ProviderDef } from '../../src/services/providers';
import type { ProviderUrlSlotInfo } from '../../src/services/api/provider-urls';

const connectProviderMock = vi.fn().mockResolvedValue({});
const getProviderUrlSlotsMock = vi.fn();

vi.mock('../../src/services/api.js', () => ({
  connectProvider: (...args: unknown[]) => connectProviderMock(...args),
  disconnectProvider: vi.fn(),
  revokeOpenaiOAuth: vi.fn(),
  renameProviderKey: vi.fn(),
  reorderProviderKeys: vi.fn(),
}));

vi.mock('../../src/services/api/provider-urls.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/api/provider-urls')>()),
  getProviderUrlSlots: (...args: unknown[]) => getProviderUrlSlotsMock(...args),
}));

vi.mock('../../src/services/provider-utils.js', () => ({
  validateApiKey: () => ({ valid: true }),
  validateSubscriptionKey: () => ({ valid: true }),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import ConnectionUrlsTab, {
  urlOverrideChanges,
  urlOverridesToCreate,
  validateUrlOverride,
  type UrlDraft,
} from '../../src/components/ConnectionUrlsTab';
import { AddConnectionUrlsTabs } from '../../src/components/ConnectionUrlsScope';
import ProviderKeyForm from '../../src/components/ProviderKeyForm';

const slots: ProviderUrlSlotInfo[] = [
  {
    id: 'inference',
    purpose: 'inference',
    kind: 'base',
    credential: 'access',
    default: 'https://api.deepseek.com',
  },
  {
    id: 'status_page',
    purpose: 'no_such_purpose',
    kind: 'url',
    credential: 'none',
    default: 'https://status.example.com/feed?format=json',
  },
];

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function Controlled({ initial = {} }: { initial?: UrlDraft }) {
  const [value, setValue] = useState<UrlDraft>(initial);
  return (
    <>
      <ConnectionUrlsTab slots={slots} value={value} onChange={setValue} />
      <output data-testid="draft">{JSON.stringify(value)}</output>
    </>
  );
}

describe('ConnectionUrlsTab', () => {
  it('shows one row per slot with the default as placeholder and the purpose label', () => {
    render(<Controlled />);
    const inference = screen.getByLabelText('Inference') as HTMLInputElement;
    expect(inference.placeholder).toBe('https://api.deepseek.com');
    // An unknown purpose falls back to the slot id.
    expect((screen.getByLabelText('status_page') as HTMLInputElement).placeholder).toBe(
      'https://status.example.com/feed?format=json',
    );
    // Only the slot that receives the credential warns.
    expect(screen.getAllByText("The account's credential is sent to this URL.")).toHaveLength(1);
    expect(screen.queryByText('Restore default')).toBeNull();
  });

  it('restores a slot to its default by emptying it', () => {
    render(<Controlled initial={{ inference: 'https://proxy.test' }} />);
    fireEvent.click(screen.getByText('Restore default'));
    expect(screen.getByTestId('draft').textContent).toBe('{"inference":""}');
  });

  it('flags a URL with the wrong shape inline', () => {
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText('Inference'), {
      target: { value: 'ftp://proxy.test' },
    });
    expect(screen.getByText('Use an http:// or https:// URL.')).toBeTruthy();
  });
});

describe('URL override helpers', () => {
  const inference = slots[0]!;
  const withQuery = slots[1]!;

  it('validates the shape of an override', () => {
    expect(validateUrlOverride('', inference)).toBeNull();
    expect(validateUrlOverride('https://proxy.test/v1', inference)).toBeNull();
    expect(validateUrlOverride('not a url', inference)).toMatch(/full URL/);
    expect(validateUrlOverride('file:///etc/passwd', inference)).toMatch(/http/);
    expect(validateUrlOverride('https://u:p@proxy.test', inference)).toMatch(/password/);
    expect(validateUrlOverride('https://proxy.test#x', inference)).toMatch(/fragment/);
    expect(validateUrlOverride('https://proxy.test?x=1', inference)).toMatch(/query/);
    // A slot whose default has a query keeps one.
    expect(validateUrlOverride('https://mirror.test/feed?format=json', withQuery)).toBeNull();
    expect(validateUrlOverride(`https://proxy.test/${'a'.repeat(2048)}`, inference)).toMatch(
      /too long/,
    );
  });

  it('sends only the filled slots when creating an account', () => {
    expect(urlOverridesToCreate(slots, {})).toEqual({});
    expect(
      urlOverridesToCreate(slots, { inference: ' https://proxy.test ', status_page: '' }),
    ).toEqual({ inference: 'https://proxy.test' });
  });

  it('sends only the changed slots of an account, null to restore the default', () => {
    const stored = [
      { ...inference, value: 'https://proxy.test' },
      { ...withQuery, value: null },
    ];
    expect(urlOverrideChanges(stored, { inference: 'https://proxy.test' })).toEqual({});
    expect(urlOverrideChanges(stored, { inference: '' })).toEqual({ inference: null });
    expect(
      urlOverrideChanges(stored, {
        inference: 'https://proxy.test',
        status_page: 'https://mirror.test/feed?format=json',
      }),
    ).toEqual({ status_page: 'https://mirror.test/feed?format=json' });
  });
});

describe('Add account flow with a URLs tab', () => {
  const deepseek = {
    id: 'deepseek',
    name: 'DeepSeek',
    color: '#000',
    initial: 'D',
    subtitle: '',
    keyPrefix: '',
    minKeyLength: 0,
    keyPlaceholder: 'sk-...',
    models: [],
  } as unknown as ProviderDef;

  function Flow() {
    const [busy, setBusy] = useState(false);
    const [keyInput, setKeyInput] = useState('');
    const [editing, setEditing] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    return (
      <AddConnectionUrlsTabs provider="deepseek" authType="api_key">
        <ProviderKeyForm
          provDef={deepseek}
          provId="deepseek"
          agentName="test-agent"
          isSubMode={false}
          connected={false}
          selectedAuthType="api_key"
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
          newConnection
          onBack={vi.fn()}
          onUpdate={vi.fn()}
        />
      </AddConnectionUrlsTabs>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getProviderUrlSlotsMock.mockResolvedValue({ slots });
  });

  const typeKey = () =>
    fireEvent.change(screen.getByLabelText('New DeepSeek API key'), {
      target: { value: 'sk-deepseek-key' },
    });

  it('puts the URLs tab after the connection form, not first', async () => {
    render(<Flow />);
    await flush();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Connection',
      'URLs',
    ]);
    expect(screen.getByRole('tab', { name: 'Connection' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(getProviderUrlSlotsMock).toHaveBeenCalledWith('deepseek', 'api_key', undefined);
  });

  it('connects without overrides when the URLs tab was never opened', async () => {
    render(<Flow />);
    await flush();
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await flush();
    expect(connectProviderMock).toHaveBeenCalledTimes(1);
    expect(connectProviderMock.mock.calls[0]![1]).not.toHaveProperty('urlOverrides');
  });

  it('sends only the slots changed on the URLs tab', async () => {
    render(<Flow />);
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'URLs' }));
    fireEvent.change(screen.getByLabelText('Inference'), {
      target: { value: 'https://proxy.test/v1' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Connection' }));
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await flush();
    expect(connectProviderMock).toHaveBeenCalledWith(
      'test-agent',
      expect.objectContaining({ urlOverrides: { inference: 'https://proxy.test/v1' } }),
    );
  });

  it('blocks Connect on an invalid URL and shows the URLs tab', async () => {
    render(<Flow />);
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'URLs' }));
    fireEvent.change(screen.getByLabelText('Inference'), { target: { value: 'proxy' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Connection' }));
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await flush();
    expect(connectProviderMock).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'URLs' }).getAttribute('aria-selected')).toBe('true');
  });
});
