import { describe, it, expect } from 'vitest';
import { DEFAULT_TRIGGER_TEMPLATES } from 'thinker-shared';
import {
  buildPayload,
  emptyForm,
  formFromTrigger,
  kindLabel,
  kindOf,
  sampleVars,
  splitKind,
  splitRecipients,
  TRIGGER_KINDS,
  triggerTestPath,
  triggerTypeLabel,
  validateForm,
} from '../../src/components/triggers/trigger-form';
import type { TriggerView } from '../../src/services/api/triggers';

const base = {
  id: 't1',
  enabled: true,
  max_retries: 3,
  retry_delay_seconds: 30,
  timeout_seconds: 10,
  workspace_events: [],
  harness_count: 0,
  created_at: '',
  updated_at: '',
};

const webhook: TriggerView = {
  ...base,
  name: 'hook',
  type: 'webhook',
  config: {
    method: 'POST',
    url: 'https://x.io/h',
    content_type: 'application/json',
    body: '{{event.json}}',
    headers: [{ name: 'Authorization', hint: 'Bea…' }],
  },
  secrets: { hmacSecret: 'abc…' },
};

describe('trigger form', () => {
  it('prefills templates for a new trigger', () => {
    const form = emptyForm();
    expect(form.email.subject).toBe(DEFAULT_TRIGGER_TEMPLATES.email.subject);
    expect(form.telegram.text).toBe(DEFAULT_TRIGGER_TEMPLATES.telegram.text);
    expect(form.webhook.content_type).toBe('application/json');
  });

  it('keeps stored webhook headers and secrets unless changed', () => {
    const form = formFromTrigger(webhook);
    const payload = buildPayload(form, false);
    expect(payload.type).toBeUndefined();
    expect(payload.secrets).toBeUndefined();
    expect((payload.config as { headers: unknown }).headers).toEqual([{ name: 'Authorization' }]);
  });

  it('sends a typed header value, a new header, and clears a secret', () => {
    const form = formFromTrigger(webhook);
    form.webhook.headers[0].value = 'Bearer new';
    form.webhook.headers.push({ storedName: null, hint: null, name: 'X-A', value: '1' });
    form.clearSecrets = ['hmacSecret'];
    const payload = buildPayload(form, false);
    expect((payload.config as { headers: unknown }).headers).toEqual([
      { name: 'Authorization', value: 'Bearer new' },
      { name: 'X-A', value: '1' },
    ]);
    expect(payload.secrets).toEqual({ hmacSecret: null });
  });

  it('requires the API key on create, a Mailgun domain and in-range delivery numbers', () => {
    const form = emptyForm();
    form.type = 'email';
    form.email.provider = 'mailgun';
    form.max_retries = '99';
    const errors = validateForm(form, null);
    expect(Object.keys(errors).sort()).toEqual(
      ['email.domain', 'max_retries', 'name', 'secret.apiKey'].sort(),
    );
  });

  it('does not require a stored required secret when editing', () => {
    const tg: TriggerView = {
      ...base,
      name: 'tg',
      type: 'telegram',
      config: { chat_id: '1', thread_id: null, silent: false, text: 'x' },
      secrets: { botToken: '123…' },
    };
    expect(validateForm(formFromTrigger(tg), tg)).toEqual({});
  });

  it('builds an e-mail create payload with split recipients and the new key', () => {
    const form = emptyForm();
    form.name = ' ops ';
    form.type = 'email';
    form.email.to = 'a@x.io, b@x.io;c@x.io';
    form.secrets = { apiKey: 're_123' };
    const payload = buildPayload(form, true);
    expect(payload).toMatchObject({
      name: 'ops',
      type: 'email',
      secrets: { apiKey: 're_123' },
      max_retries: 3,
      config: { provider: 'resend', domain: null, to: ['a@x.io', 'b@x.io', 'c@x.io'] },
    });
  });

  it('splits recipients on commas, semicolons and spaces', () => {
    expect(splitRecipients(' a@x.io ,, b@x.io c@x.io ')).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
  });
});

describe('trigger kinds and test variables', () => {
  it('offers each e-mail provider as its own type', () => {
    expect(TRIGGER_KINDS.slice(0, 3).map(kindLabel)).toEqual([
      'Email API Resend',
      'Email API Mailgun',
      'Email API SendGrid',
    ]);
    expect(kindOf('email', 'mailgun')).toBe('email:mailgun');
    expect(splitKind('email:sendgrid')).toEqual({ type: 'email', provider: 'sendgrid' });
    expect(splitKind('webhook')).toEqual({ type: 'webhook' });
    expect(triggerTypeLabel('email', 'resend')).toBe('Email API Resend');
  });

  it('prefills the variables of the chosen event, leaving out the computed ones', () => {
    const vars = sampleVars('limit.block', { name: 'bot' });
    expect(vars['harness.name']).toBe('bot');
    expect(vars['event.title']).toBe('bot has been blocked');
    expect(vars['period.reset']).toBeTruthy();
    expect(vars).not.toHaveProperty('event.id');
    expect(vars).not.toHaveProperty('trigger.name');
    expect(vars).not.toHaveProperty('request.id');
    expect(Object.keys(sampleVars('credential.expired'))).toContain('connection.provider');
    expect(triggerTestPath('t1', 'bot')).toBe('/triggers/test?trigger=t1&harness=bot');
  });
});
