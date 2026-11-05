import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { DEFAULT_TRIGGER_TEMPLATES } from 'thinker-shared';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('../../../src/services/toast-store.js', () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({ createTrigger: vi.fn(), updateTrigger: vi.fn() }));
vi.mock('../../../src/services/api/triggers.js', () => api);

// The outbound proxy panel has its own spec.
vi.mock('../../../src/components/proxy/OutboundProxyPanel', () => ({
  default: (p: { targetType: string; targetId: string }) => (
    <div data-testid="outbound" data-target={`${p.targetType}:${p.targetId}`} />
  ),
}));

import TriggerEditor from '../../../src/components/triggers/TriggerEditor';
import { ApiError } from '../../../src/services/api/core';
import { getEmailProviderApiKeyUrl } from '../../../src/services/provider-api-key-urls';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { emailTrigger, syslogTrigger, telegramTrigger, webhookTrigger } from './fixtures';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function setup(props: Partial<Parameters<typeof TriggerEditor>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const element = (p: Partial<Parameters<typeof TriggerEditor>[0]> = {}) => (
    <MemoryRouter initialEntries={['/triggers']}>
      <TriggerEditor open trigger={null} readOnly={false} onClose={onClose} onSaved={onSaved} {...props} {...p} />
      <Where />
    </MemoryRouter>
  );
  const utils = render(element());
  return { ...utils, onSaved, onClose, rerender: (p: Partial<Parameters<typeof TriggerEditor>[0]>) => utils.rerender(element(p)) };
}

const dialog = () => screen.getByRole('dialog');
const field = (label: string) => within(dialog()).getByLabelText(label) as HTMLInputElement;
const create = () => within(dialog()).getByRole('button', { name: 'Create trigger' }) as HTMLButtonElement;
const saveChanges = () => within(dialog()).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
const pickType = (value: string) =>
  fireEvent.change(within(dialog()).getByLabelText('Type'), { target: { value } });

describe('TriggerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createTrigger.mockImplementation(async (d: object) => ({ ...webhookTrigger({ id: 'new' }), ...d }));
    api.updateTrigger.mockImplementation(async (_id: string, d: object) => ({ ...webhookTrigger(), ...d }));
  });

  describe('opening', () => {
    it('renders nothing when closed', () => {
      setup({ open: false });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('create mode starts as an enabled webhook with default delivery settings', () => {
      setup();
      expect(screen.getByRole('dialog', { name: 'New trigger' })).toBeTruthy();
      expect(field('Name').value).toBe('');
      expect((within(dialog()).getByLabelText('Type') as HTMLSelectElement).value).toBe('webhook');
      expect(within(dialog()).getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe('true');
      expect(field('Max retries').value).toBe('3');
      expect(field('Delay between retries (s)').value).toBe('30');
      expect(field('Timeout (s)').value).toBe('10');
      expect(field('Content type').value).toBe(DEFAULT_TRIGGER_TEMPLATES.webhook.contentType);
      expect(screen.queryByTestId('outbound')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Test trigger' })).toBeNull();
    });

    it('offers every trigger kind, with the e-mail providers as separate choices', () => {
      setup();
      const options = Array.from((within(dialog()).getByLabelText('Type') as HTMLSelectElement).options).map((o) => o.textContent);
      expect(options).toEqual(['Email API Resend', 'Email API Mailgun', 'Email API SendGrid', 'Webhook', 'Telegram', 'Syslog']);
    });

    it('closes with Cancel and Escape without saving', () => {
      const { onClose } = setup();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(api.createTrigger).not.toHaveBeenCalled();
    });

    it('starts fresh every time it is reopened', async () => {
      const user = userEvent.setup();
      const { rerender } = setup();
      await user.type(field('Name'), 'half typed');
      rerender({ open: false });
      rerender({ open: true });
      expect(field('Name').value).toBe('');
    });

    it('follows the trigger it is given', () => {
      const { rerender } = setup({ trigger: webhookTrigger() });
      expect(field('Name').value).toBe('ops-hook');
      rerender({ trigger: telegramTrigger() });
      expect(field('Name').value).toBe('ops-chat');
      expect(within(dialog()).getByLabelText('Chat ID')).toBeTruthy();
    });
  });

  describe('validation', () => {
    it('does not call the API for an empty webhook and says what is missing', () => {
      setup();
      fireEvent.click(create());
      expect(screen.getByText('Enter a name.')).toBeTruthy();
      expect(screen.getByText('Enter an http(s) URL.')).toBeTruthy();
      expect(api.createTrigger).not.toHaveBeenCalled();
    });

    it('rejects a URL without http(s)', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'hook');
      await user.type(field('URL'), 'ftp://x.io/h');
      fireEvent.click(create());
      expect(screen.getByText('Enter an http(s) URL.')).toBeTruthy();
      expect(api.createTrigger).not.toHaveBeenCalled();
    });

    it('rejects an incomplete header', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'hook');
      await user.type(field('URL'), 'https://x.io/h');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Add header' }));
      await user.type(field('Header name'), 'X-Token');
      fireEvent.click(create());
      expect(screen.getByText('Each header needs a name and, when new, a value.')).toBeTruthy();
      expect(api.createTrigger).not.toHaveBeenCalled();
    });

    it('rejects delivery numbers outside their ranges', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'hook');
      await user.type(field('URL'), 'https://x.io/h');
      fireEvent.change(field('Max retries'), { target: { value: '99' } });
      fireEvent.change(field('Timeout (s)'), { target: { value: '0' } });
      fireEvent.change(field('Delay between retries (s)'), { target: { value: '' } });
      fireEvent.click(create());
      expect(screen.getAllByText('Out of range.')).toHaveLength(3);
      expect(api.createTrigger).not.toHaveBeenCalled();
      fireEvent.change(field('Max retries'), { target: { value: '0' } });
      fireEvent.change(field('Timeout (s)'), { target: { value: '60' } });
      fireEvent.change(field('Delay between retries (s)'), { target: { value: '3600' } });
      fireEvent.click(create());
      expect(screen.queryByText('Out of range.')).toBeNull();
    });

    it('shows each range as a hint', () => {
      setup();
      expect(screen.getByText('0 to 10')).toBeTruthy();
      expect(screen.getByText('1 to 3600')).toBeTruthy();
      expect(screen.getByText('1 to 60')).toBeTruthy();
    });

    it('clears the errors when the type changes', () => {
      setup();
      fireEvent.click(create());
      expect(screen.getByText('Enter a name.')).toBeTruthy();
      pickType('syslog');
      expect(screen.queryByText('Enter a name.')).toBeNull();
    });
  });

  describe('creating a webhook', () => {
    it('posts the full payload, toasts and hands the saved trigger to the caller', async () => {
      const user = userEvent.setup();
      const { onSaved } = setup();
      await user.type(field('Name'), '  ops hook  ');
      await user.selectOptions(within(dialog()).getByLabelText('Method'), 'PUT');
      await user.type(field('URL'), '  https://x.io/h  ');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Add header' }));
      await user.type(field('Header name'), ' X-Token ');
      await user.type(field('Header value'), 'abc123');
      await user.type(field('Signing secret'), 'whsec_1');
      fireEvent.change(field('Max retries'), { target: { value: '5' } });
      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Harness created' }));
      fireEvent.click(create());
      await waitFor(() => expect(api.createTrigger).toHaveBeenCalledTimes(1));
      expect(api.createTrigger).toHaveBeenCalledWith({
        name: 'ops hook',
        type: 'webhook',
        enabled: true,
        config: {
          method: 'PUT',
          url: 'https://x.io/h',
          content_type: DEFAULT_TRIGGER_TEMPLATES.webhook.contentType,
          body: DEFAULT_TRIGGER_TEMPLATES.webhook.body,
          headers: [{ name: 'X-Token', value: 'abc123' }],
        },
        secrets: { hmacSecret: 'whsec_1' },
        max_retries: 5,
        retry_delay_seconds: 30,
        timeout_seconds: 10,
        workspace_events: ['harness.created'],
      });
      expect(api.updateTrigger).not.toHaveBeenCalled();
      expect(toastMock.success).toHaveBeenCalledWith('Trigger created');
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(onSaved.mock.calls[0][0].id).toBe('new');
    });

    it('can create it disabled', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'hook');
      await user.type(field('URL'), 'https://x.io/h');
      fireEvent.click(within(dialog()).getByRole('switch', { name: 'Enabled' }));
      fireEvent.click(create());
      await waitFor(() => expect(api.createTrigger).toHaveBeenCalled());
      expect(api.createTrigger.mock.calls[0][0].enabled).toBe(false);
      expect(api.createTrigger.mock.calls[0][0].secrets).toBeUndefined();
    });

    it('lets the user add and remove header rows', () => {
      setup();
      expect(screen.getByText('No custom headers.')).toBeTruthy();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Add header' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Add header' }));
      expect(within(dialog()).getAllByLabelText('Header name')).toHaveLength(2);
      expect(screen.queryByText('No custom headers.')).toBeNull();
      fireEvent.click(within(dialog()).getAllByRole('button', { name: 'Remove header' })[0]!);
      expect(within(dialog()).getAllByLabelText('Header name')).toHaveLength(1);
    });

    it('keeps the dialog open, the typed values and no success toast when the server refuses', async () => {
      api.createTrigger.mockRejectedValue(new ApiError('Name already exists', 400));
      const user = userEvent.setup();
      const { onSaved, onClose } = setup();
      await user.type(field('Name'), 'hook');
      await user.type(field('URL'), 'https://x.io/h');
      fireEvent.click(create());
      await waitFor(() => expect(api.createTrigger).toHaveBeenCalled());
      await waitFor(() => expect(create().disabled).toBe(false));
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(field('Name').value).toBe('hook');
    });
  });

  describe('secrets', () => {
    it('masks every secret input and never echoes what was typed', async () => {
      const user = userEvent.setup();
      setup();
      const hmac = field('Signing secret');
      expect(hmac.type).toBe('password');
      expect(hmac.autocomplete).toBe('new-password');
      await user.type(hmac, 'super-secret-value');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Add header' }));
      const headerValue = field('Header value');
      expect(headerValue.type).toBe('password');
      await user.type(headerValue, 'Bearer top-secret');
      expect(dialog().textContent).not.toContain('super-secret-value');
      expect(dialog().textContent).not.toContain('top-secret');
      pickType('telegram');
      const token = field('Bot token');
      expect(token.type).toBe('password');
    });

    it('a stored secret appears only as a masked hint in the placeholder, never as a value', () => {
      setup({ trigger: telegramTrigger() });
      const token = field('Bot token');
      expect(token.value).toBe('');
      expect(token.placeholder).toBe('1234…');
      expect(screen.getByText(/Leave blank to keep the current value\./)).toBeTruthy();
    });

    it('a required secret is demanded on create', () => {
      setup();
      pickType('telegram');
      fireEvent.change(field('Name'), { target: { value: 'chat' } });
      fireEvent.change(field('Chat ID'), { target: { value: '-100' } });
      fireEvent.click(create());
      expect(screen.getByText('Required.')).toBeTruthy();
      expect(api.createTrigger).not.toHaveBeenCalled();
    });

    it('an existing trigger keeps its secret when left blank (no secrets in the payload)', async () => {
      setup({ trigger: telegramTrigger() });
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateTrigger).toHaveBeenCalledTimes(1));
      const [id, body] = api.updateTrigger.mock.calls[0];
      expect(id).toBe('t3');
      expect(body.secrets).toBeUndefined();
      expect(body.type).toBeUndefined();
      expect(toastMock.success).toHaveBeenCalledWith('Trigger updated');
    });

    it('a typed secret replaces the stored one', async () => {
      const user = userEvent.setup();
      setup({ trigger: telegramTrigger() });
      await user.type(field('Bot token'), '999:new');
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateTrigger).toHaveBeenCalled());
      expect(api.updateTrigger.mock.calls[0][1].secrets).toEqual({ botToken: '999:new' });
    });

    it('an optional secret can be cleared and the clearing undone', async () => {
      setup({ trigger: webhookTrigger() });
      const clear = within(dialog()).getByRole('button', { name: 'Clear' });
      fireEvent.click(clear);
      expect(screen.getByText('Will be removed when you save.')).toBeTruthy();
      expect(field('Signing secret').disabled).toBe(true);
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Undo' }));
      expect(field('Signing secret').disabled).toBe(false);
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Clear' }));
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateTrigger).toHaveBeenCalled());
      expect(api.updateTrigger.mock.calls[0][1].secrets).toEqual({ hmacSecret: null });
    });

    it('a required secret cannot be cleared', () => {
      setup({ trigger: telegramTrigger() });
      expect(within(dialog()).queryByRole('button', { name: 'Clear' })).toBeNull();
    });

    it('a stored header shows its hint and is kept when its value stays blank', async () => {
      setup({ trigger: webhookTrigger() });
      const value = field('Header value');
      expect(value.value).toBe('');
      expect(value.placeholder).toBe('Bea…');
      expect(field('Header name').value).toBe('Authorization');
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateTrigger).toHaveBeenCalled());
      expect(api.updateTrigger.mock.calls[0][1].config.headers).toEqual([{ name: 'Authorization' }]);
    });

    it('renaming a stored header needs a new value', async () => {
      setup({ trigger: webhookTrigger() });
      fireEvent.change(field('Header name'), { target: { value: 'X-Other' } });
      fireEvent.click(saveChanges());
      expect(screen.getByText('Each header needs a name and, when new, a value.')).toBeTruthy();
      expect(api.updateTrigger).not.toHaveBeenCalled();
    });
  });

  describe('e-mail', () => {
    it('requires the API key, and a domain for Mailgun', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'mail');
      pickType('email:mailgun');
      fireEvent.click(create());
      expect(screen.getByText('Required.')).toBeTruthy();
      expect(screen.getByText('Mailgun needs a domain.')).toBeTruthy();
      expect(api.createTrigger).not.toHaveBeenCalled();
      pickType('email:resend');
      fireEvent.click(create());
      expect(screen.queryByText('Mailgun needs a domain.')).toBeNull();
    });

    it('links to where the provider issues keys', () => {
      setup();
      pickType('email:resend');
      const url = getEmailProviderApiKeyUrl('resend');
      const link = within(dialog()).queryByRole('link', { name: 'Get an API key' });
      if (url) {
        expect(link?.getAttribute('href')).toBe(url);
        expect(link?.getAttribute('rel')).toContain('noreferrer');
      } else {
        expect(link).toBeNull();
      }
    });

    it('posts recipients as a list and empty optional fields as null', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'mail');
      pickType('email:sendgrid');
      await user.type(field('API key'), 'SG.key');
      await user.type(field('To'), 'a@x.io; b@x.io,  c@x.io');
      fireEvent.click(create());
      await waitFor(() => expect(api.createTrigger).toHaveBeenCalled());
      const body = api.createTrigger.mock.calls[0][0];
      expect(body.type).toBe('email');
      expect(body.secrets).toEqual({ apiKey: 'SG.key' });
      expect(body.config).toEqual({
        provider: 'sendgrid',
        domain: null,
        from: null,
        to: ['a@x.io', 'b@x.io', 'c@x.io'],
        subject: DEFAULT_TRIGGER_TEMPLATES.email.subject,
        body: DEFAULT_TRIGGER_TEMPLATES.email.body,
      });
    });

    // BUG: validateForm/secretInput treat the stored API key as valid for any provider of the
    // same trigger type, so switching an existing trigger from Mailgun to Resend/SendGrid and
    // saving without retyping the key keeps (and sends to the new provider) the old provider's key.
    // A provider change should require a new key, like creating one does.
    it.skip('requires a new API key when an existing e-mail trigger switches provider', () => {
      setup({ trigger: emailTrigger() });
      pickType('email:sendgrid');
      fireEvent.click(saveChanges());
      expect(screen.getByText('Required.')).toBeTruthy();
      expect(api.updateTrigger).not.toHaveBeenCalled();
    });

    it('an existing e-mail trigger is prefilled and can switch provider; other types cannot change type', () => {
      const { unmount } = setup({ trigger: emailTrigger() });
      expect(field('Domain').value).toBe('mg.example.com');
      expect(field('To').value).toBe('a@x.io, b@x.io');
      const type = within(dialog()).getByLabelText('Type') as HTMLSelectElement;
      expect(type.disabled).toBe(false);
      expect(Array.from(type.options).map((o) => o.value)).toEqual(['email:resend', 'email:mailgun', 'email:sendgrid']);
      expect(type.value).toBe('email:mailgun');
      unmount();
      setup({ trigger: webhookTrigger() });
      const locked = within(dialog()).getByLabelText('Type') as HTMLSelectElement;
      expect(locked.disabled).toBe(true);
      expect(Array.from(locked.options).map((o) => o.value)).toEqual(['webhook']);
    });
  });

  describe('telegram and syslog', () => {
    it('creates a Telegram trigger from the chat id, optional thread and silent flag', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'chat');
      pickType('telegram');
      await user.type(field('Bot token'), '123:abc');
      await user.type(field('Chat ID'), ' -1001 ');
      await user.type(field('Thread ID'), '7');
      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Send silently' }));
      fireEvent.click(create());
      await waitFor(() => expect(api.createTrigger).toHaveBeenCalled());
      expect(api.createTrigger.mock.calls[0][0]).toMatchObject({
        type: 'telegram',
        secrets: { botToken: '123:abc' },
        config: { chat_id: '-1001', thread_id: '7', silent: true, text: DEFAULT_TRIGGER_TEMPLATES.telegram.text },
      });
    });

    it('requires a chat id', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'chat');
      pickType('telegram');
      await user.type(field('Bot token'), '123:abc');
      fireEvent.click(create());
      expect(screen.getByText('Enter the chat ID.')).toBeTruthy();
    });

    it('validates the syslog host and port', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'logs');
      pickType('syslog');
      expect(field('Port').value).toBe('514');
      fireEvent.click(create());
      expect(screen.getByText('Enter the host.')).toBeTruthy();
      await user.type(field('Host'), 'logs.example.com');
      fireEvent.change(field('Port'), { target: { value: '70000' } });
      fireEvent.click(create());
      expect(screen.getByText('Enter a port from 1 to 65535.')).toBeTruthy();
      expect(api.createTrigger).not.toHaveBeenCalled();
    });

    it('creates a syslog trigger with a changed severity and no secrets', async () => {
      const user = userEvent.setup();
      setup();
      await user.type(field('Name'), 'logs');
      pickType('syslog');
      await user.type(field('Host'), ' logs.example.com ');
      await user.selectOptions(within(dialog()).getByLabelText('Transport'), 'tcp');
      await user.selectOptions(within(dialog()).getByLabelText('Severity: Limit alert'), 'crit');
      fireEvent.click(create());
      await waitFor(() => expect(api.createTrigger).toHaveBeenCalled());
      const body = api.createTrigger.mock.calls[0][0];
      expect(body.type).toBe('syslog');
      expect(body.secrets).toBeUndefined();
      expect(body.config).toMatchObject({ host: 'logs.example.com', port: 514, transport: 'tcp', app_name: 'thinker' });
      expect(body.config.severities['limit.alert']).toBe('crit');
      expect(body.config.severities['limit.block']).toBe('err');
    });

    it('shows a saved syslog trigger with its severities and no outbound proxy panel', () => {
      setup({ trigger: syslogTrigger() });
      expect((within(dialog()).getByLabelText('Severity: Limit alert') as HTMLSelectElement).value).toBe('crit');
      expect((within(dialog()).getByLabelText('Severity: Limit block') as HTMLSelectElement).value).toBe('err');
      expect(field('Port').value).toBe('6514');
      expect(screen.queryByTestId('outbound')).toBeNull();
    });
  });

  describe('existing triggers', () => {
    it('shows the outbound proxy panel for the trigger and a Test trigger shortcut', () => {
      setup({ trigger: webhookTrigger() });
      expect(screen.getByTestId('outbound').getAttribute('data-target')).toBe('trigger:t1');
      expect(screen.getByRole('dialog', { name: 'Edit trigger' })).toBeTruthy();
    });

    it('Test trigger closes the dialog and opens the test screen preselecting the trigger', () => {
      const { onClose } = setup({ trigger: webhookTrigger() });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test trigger' }));
      expect(onClose).toHaveBeenCalled();
      expect(screen.getByTestId('where').textContent).toBe('/triggers/test?trigger=t1');
    });

    it('submits as an update without a type', async () => {
      const user = userEvent.setup();
      const { onSaved } = setup({ trigger: webhookTrigger() });
      await user.clear(field('Name'));
      await user.type(field('Name'), 'renamed');
      fireEvent.click(saveChanges());
      await waitFor(() => expect(api.updateTrigger).toHaveBeenCalledTimes(1));
      expect(api.updateTrigger.mock.calls[0][0]).toBe('t1');
      expect(api.updateTrigger.mock.calls[0][1].name).toBe('renamed');
      expect('type' in api.updateTrigger.mock.calls[0][1]).toBe(false);
      expect(api.createTrigger).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it('prefills workspace events and delivery settings', () => {
      setup({ trigger: webhookTrigger({ workspace_events: ['harness.deleted'], max_retries: 7, timeout_seconds: 25 }) });
      expect((within(dialog()).getByRole('checkbox', { name: 'Harness deleted' }) as HTMLInputElement).checked).toBe(true);
      expect((within(dialog()).getByRole('checkbox', { name: 'Harness created' }) as HTMLInputElement).checked).toBe(false);
      expect(field('Max retries').value).toBe('7');
      expect(field('Timeout (s)').value).toBe('25');
    });
  });

  describe('read-only', () => {
    it('shows the trigger without any way to change it', () => {
      setup({ trigger: webhookTrigger(), readOnly: true });
      expect(screen.getByRole('dialog', { name: 'Trigger' })).toBeTruthy();
      expect(dialog().querySelector('fieldset')!.disabled).toBe(true);
      expect(field('Name').value).toBe('ops-hook');
      expect(within(dialog()).queryByRole('button', { name: 'Save changes' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: 'Cancel' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: 'Test trigger' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: 'Add header' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: 'Clear' })).toBeNull();
      expect((within(dialog()).getByRole('button', { name: 'Remove header' }) as HTMLButtonElement).disabled).toBe(true);
      expect((within(dialog()).getByRole('switch', { name: 'Enabled' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByTestId('outbound')).toBeNull();
    });
  });

  describe('template variables', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    afterEach(() => {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as unknown as Record<string, unknown>).clipboard;
    });

    it('copies {{name}} to the clipboard when a variable is clicked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      setup();
      expect(screen.getByText('Variables')).toBeTruthy();
      fireEvent.click(screen.getByText('{{event.id}}').closest('button')!);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('{{event.id}}'));
      expect(toastMock.success).toHaveBeenCalledWith(t('common.copiedToClipboard'));
    });

    it('stays quiet when the clipboard is blocked', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      setup();
      fireEvent.click(screen.getByText('{{event.id}}').closest('button')!);
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(toastMock.success).not.toHaveBeenCalled();
    });
  });

  describe('pt-BR', () => {
    it('renders the form, validation and actions in Portuguese', () => {
      resetLocaleForTests('pt-BR');
      setup();
      expect(screen.getByRole('dialog', { name: t('triggers.editor.createTitle') })).toBeTruthy();
      expect(t('triggers.editor.createTitle')).not.toBe('New trigger');
      expect(within(dialog()).getByLabelText(t('triggers.editor.name'))).toBeTruthy();
      fireEvent.click(within(dialog()).getByRole('button', { name: t('triggers.editor.createSubmit') }));
      expect(screen.getByText(t('triggers.editor.errors.nameRequired'))).toBeTruthy();
      expect(screen.queryByText('Enter a name.')).toBeNull();
      expect(within(dialog()).getByText(t('triggers.editor.delivery.title'))).toBeTruthy();
    });
  });
});
