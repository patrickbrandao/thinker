import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_SYSLOG_SEVERITIES,
  EMAIL_TRIGGER_PROVIDERS,
  SYSLOG_FACILITIES,
  SYSLOG_FORMATS,
  SYSLOG_SEVERITIES,
  SYSLOG_TRANSPORTS,
  TRIGGER_LIMITS,
  TRIGGER_TYPES,
  TRIGGER_VARIABLES,
  WEBHOOK_METHODS,
  WORKSPACE_TRIGGER_EVENTS,
  type SyslogSeverity,
  type TriggerType,
} from 'thinker-shared';
import { t } from '../../i18n/index.js';
import { getEmailProviderApiKeyUrl } from '../../services/provider-api-key-urls.js';
import { toast } from '../../services/toast-store.js';
import {
  createTrigger,
  testTrigger,
  updateTrigger,
  type TriggerTestResult,
  type TriggerView,
} from '../../services/api/triggers.js';
import { Button, Field, IconButton, Modal, Switch } from '../ui.js';
import { TriggerTestResultView } from './TriggerParts.js';
import {
  buildPayload,
  emptyForm,
  eventLabel,
  formFromTrigger,
  triggerTypeLabel,
  validateForm,
  type TriggerForm,
} from './trigger-form.js';

const SECRET_LABELS: Record<string, () => string> = {
  apiKey: () => t('triggers.editor.email.apiKey'),
  hmacSecret: () => t('triggers.editor.webhook.hmacSecret'),
  botToken: () => t('triggers.editor.telegram.botToken'),
};

/**
 * Create, edit or (read-only) view a trigger. `trigger` null creates one.
 * Saving closes the dialog and hands the saved trigger to `onSaved`.
 */
export default function TriggerEditor({
  open,
  trigger,
  readOnly,
  onClose,
  onSaved,
}: {
  open: boolean;
  trigger: TriggerView | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (trigger: TriggerView) => void;
}) {
  const [form, setForm] = useState<TriggerForm>(() =>
    trigger ? formFromTrigger(trigger) : emptyForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TriggerTestResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(trigger ? formFromTrigger(trigger) : emptyForm());
    setErrors({});
    setTestResult(null);
  }, [open, trigger]);

  const isCreate = !trigger;
  const patch = <K extends keyof TriggerForm>(key: K, value: TriggerForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const patchIn = <K extends 'email' | 'webhook' | 'telegram' | 'syslog'>(
    key: K,
    value: Partial<TriggerForm[K]>,
  ) => setForm((f) => ({ ...f, [key]: { ...f[key], ...value } }));

  const handleSave = async () => {
    const found = validateForm(form, trigger);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = buildPayload(form, isCreate);
      const saved = trigger
        ? await updateTrigger(trigger.id, payload)
        : await createTrigger(payload);
      toast.success(isCreate ? t('triggers.toast.created') : t('triggers.toast.updated'));
      onSaved(saved);
    } catch {
      // the backend's 400 messages are toasted by fetchMutate
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!trigger) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testTrigger(trigger.id));
    } catch {
      // toasted
    } finally {
      setTesting(false);
    }
  };

  const title = readOnly
    ? t('triggers.editor.viewTitle')
    : isCreate
      ? t('triggers.editor.createTitle')
      : t('triggers.editor.editTitle');

  const secretInput = (key: string, required: boolean, hint?: ReactNode) => {
    const stored = trigger && trigger.type === form.type ? (trigger.secrets?.[key] ?? null) : null;
    const cleared = form.clearSecrets.includes(key);
    const id = `trigger-secret-${key}`;
    return (
      <Field
        key={key}
        label={SECRET_LABELS[key]?.() ?? key}
        htmlFor={id}
        error={errors[`secret.${key}`]}
        hint={
          cleared ? (
            t('triggers.editor.secretCleared')
          ) : stored ? (
            <>
              {t('triggers.editor.secretKeep')} {hint}
            </>
          ) : (
            hint
          )
        }
      >
        <div className="flex items-center gap-2">
          <input
            id={id}
            className="field"
            type="password"
            autoComplete="new-password"
            placeholder={stored ?? (required ? '' : t('triggers.editor.secretNotSet'))}
            value={form.secrets[key] ?? ''}
            disabled={cleared}
            onChange={(e) => patch('secrets', { ...form.secrets, [key]: e.currentTarget.value })}
          />
          {!required && stored && !readOnly ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                patch(
                  'clearSecrets',
                  cleared
                    ? form.clearSecrets.filter((k) => k !== key)
                    : [...form.clearSecrets, key],
                )
              }
            >
              {cleared ? t('triggers.editor.secretUndo') : t('triggers.editor.secretClear')}
            </Button>
          ) : null}
        </div>
      </Field>
    );
  };

  const keyUrl = form.type === 'email' ? getEmailProviderApiKeyUrl(form.email.provider) : undefined;

  return (
    <Modal open={open} title={title} onClose={onClose} wide>
      <fieldset disabled={readOnly} className="m-0 grid min-w-0 gap-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-start">
          <Field label={t('triggers.editor.name')} htmlFor="trigger-name" error={errors.name}>
            <input
              id="trigger-name"
              className="field"
              type="text"
              placeholder={t('triggers.editor.namePlaceholder')}
              value={form.name}
              onChange={(e) => patch('name', e.currentTarget.value)}
              autoFocus
            />
          </Field>
          <Field label={t('triggers.editor.type')} htmlFor="trigger-type">
            <select
              id="trigger-type"
              className="field"
              value={form.type}
              disabled={!isCreate}
              onChange={(e) => {
                patch('type', e.currentTarget.value as TriggerType);
                setErrors({});
              }}
            >
              {TRIGGER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {triggerTypeLabel(type)}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <span className="label">{t('triggers.editor.enabled')}</span>
            <div className="flex h-[34px] items-center">
              <Switch
                checked={form.enabled}
                onChange={(v) => patch('enabled', v)}
                label={t('triggers.editor.enabled')}
                disabled={readOnly}
              />
            </div>
          </div>
        </div>

        {form.type === 'email' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('triggers.editor.email.provider')} htmlFor="trigger-email-provider">
                <select
                  id="trigger-email-provider"
                  className="field"
                  value={form.email.provider}
                  onChange={(e) =>
                    patchIn('email', {
                      provider: e.currentTarget.value as TriggerForm['email']['provider'],
                    })
                  }
                >
                  {EMAIL_TRIGGER_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_NAMES[p]}
                    </option>
                  ))}
                </select>
              </Field>
              {secretInput(
                'apiKey',
                true,
                keyUrl ? (
                  <a href={keyUrl} target="_blank" rel="noreferrer" className="text-accent">
                    {t('triggers.editor.email.getKey')}
                  </a>
                ) : null,
              )}
              <Field
                label={t('triggers.editor.email.domain')}
                htmlFor="trigger-email-domain"
                hint={t('triggers.editor.email.domainHint')}
                error={errors['email.domain']}
              >
                <input
                  id="trigger-email-domain"
                  className="field"
                  type="text"
                  value={form.email.domain}
                  onChange={(e) => patchIn('email', { domain: e.currentTarget.value })}
                />
              </Field>
              <Field
                label={t('triggers.editor.email.from')}
                htmlFor="trigger-email-from"
                hint={t('triggers.editor.email.fromHint')}
              >
                <input
                  id="trigger-email-from"
                  className="field"
                  type="email"
                  placeholder={t('triggers.editor.email.fromPlaceholder')}
                  value={form.email.from}
                  onChange={(e) => patchIn('email', { from: e.currentTarget.value })}
                />
              </Field>
            </div>
            <Field
              label={t('triggers.editor.email.to')}
              htmlFor="trigger-email-to"
              hint={t('triggers.editor.email.toHint')}
            >
              <input
                id="trigger-email-to"
                className="field"
                type="text"
                placeholder={t('triggers.editor.email.toPlaceholder')}
                value={form.email.to}
                onChange={(e) => patchIn('email', { to: e.currentTarget.value })}
              />
            </Field>
            <Field label={t('triggers.editor.email.subject')} htmlFor="trigger-email-subject">
              <input
                id="trigger-email-subject"
                className="field font-mono"
                type="text"
                value={form.email.subject}
                onChange={(e) => patchIn('email', { subject: e.currentTarget.value })}
              />
            </Field>
            <Field label={t('triggers.editor.email.body')} htmlFor="trigger-email-body">
              <textarea
                id="trigger-email-body"
                className="field min-h-[96px] font-mono"
                value={form.email.body}
                onChange={(e) => patchIn('email', { body: e.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}

        {form.type === 'webhook' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
              <Field label={t('triggers.editor.webhook.method')} htmlFor="trigger-webhook-method">
                <select
                  id="trigger-webhook-method"
                  className="field"
                  value={form.webhook.method}
                  onChange={(e) =>
                    patchIn('webhook', {
                      method: e.currentTarget.value as TriggerForm['webhook']['method'],
                    })
                  }
                >
                  {WEBHOOK_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('triggers.editor.webhook.url')}
                htmlFor="trigger-webhook-url"
                error={errors['webhook.url']}
              >
                <input
                  id="trigger-webhook-url"
                  className="field font-mono"
                  type="url"
                  placeholder={t('triggers.editor.webhook.urlPlaceholder')}
                  value={form.webhook.url}
                  onChange={(e) => patchIn('webhook', { url: e.currentTarget.value })}
                />
              </Field>
            </div>
            <HeaderEditor
              form={form}
              readOnly={readOnly}
              error={errors['webhook.headers']}
              onChange={(headers) => patchIn('webhook', { headers })}
            />
            {secretInput('hmacSecret', false, t('triggers.editor.webhook.hmacHint'))}
            <Field
              label={t('triggers.editor.webhook.contentType')}
              htmlFor="trigger-webhook-content-type"
            >
              <input
                id="trigger-webhook-content-type"
                className="field font-mono"
                type="text"
                value={form.webhook.content_type}
                onChange={(e) => patchIn('webhook', { content_type: e.currentTarget.value })}
              />
            </Field>
            <Field label={t('triggers.editor.webhook.body')} htmlFor="trigger-webhook-body">
              <textarea
                id="trigger-webhook-body"
                className="field min-h-[96px] font-mono"
                value={form.webhook.body}
                onChange={(e) => patchIn('webhook', { body: e.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}

        {form.type === 'telegram' ? (
          <>
            {secretInput('botToken', true)}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('triggers.editor.telegram.chatId')}
                htmlFor="trigger-telegram-chat"
                error={errors['telegram.chat_id']}
              >
                <input
                  id="trigger-telegram-chat"
                  className="field font-mono"
                  type="text"
                  placeholder={t('triggers.editor.telegram.chatIdPlaceholder')}
                  value={form.telegram.chat_id}
                  onChange={(e) => patchIn('telegram', { chat_id: e.currentTarget.value })}
                />
              </Field>
              <Field
                label={t('triggers.editor.telegram.threadId')}
                htmlFor="trigger-telegram-thread"
                hint={t('triggers.editor.telegram.threadIdHint')}
              >
                <input
                  id="trigger-telegram-thread"
                  className="field font-mono"
                  type="text"
                  value={form.telegram.thread_id}
                  onChange={(e) => patchIn('telegram', { thread_id: e.currentTarget.value })}
                />
              </Field>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.telegram.silent}
                onChange={(e) => patchIn('telegram', { silent: e.currentTarget.checked })}
              />
              {t('triggers.editor.telegram.silent')}
            </label>
            <Field
              label={t('triggers.editor.telegram.text')}
              htmlFor="trigger-telegram-text"
              hint={t('triggers.editor.telegram.textHint')}
            >
              <textarea
                id="trigger-telegram-text"
                className="field min-h-[96px] font-mono"
                value={form.telegram.text}
                onChange={(e) => patchIn('telegram', { text: e.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}

        {form.type === 'syslog' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_110px_110px]">
              <Field
                label={t('triggers.editor.syslog.host')}
                htmlFor="trigger-syslog-host"
                error={errors['syslog.host']}
              >
                <input
                  id="trigger-syslog-host"
                  className="field font-mono"
                  type="text"
                  placeholder={t('triggers.editor.syslog.hostPlaceholder')}
                  value={form.syslog.host}
                  onChange={(e) => patchIn('syslog', { host: e.currentTarget.value })}
                />
              </Field>
              <Field
                label={t('triggers.editor.syslog.port')}
                htmlFor="trigger-syslog-port"
                error={errors['syslog.port']}
              >
                <input
                  id="trigger-syslog-port"
                  className="field font-mono"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.syslog.port}
                  onChange={(e) => patchIn('syslog', { port: e.currentTarget.value })}
                />
              </Field>
              <Field
                label={t('triggers.editor.syslog.transport')}
                htmlFor="trigger-syslog-transport"
              >
                <select
                  id="trigger-syslog-transport"
                  className="field"
                  value={form.syslog.transport}
                  onChange={(e) =>
                    patchIn('syslog', {
                      transport: e.currentTarget.value as TriggerForm['syslog']['transport'],
                    })
                  }
                >
                  {SYSLOG_TRANSPORTS.map((v) => (
                    <option key={v} value={v}>
                      {v.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('triggers.editor.syslog.format')} htmlFor="trigger-syslog-format">
                <select
                  id="trigger-syslog-format"
                  className="field"
                  value={form.syslog.format}
                  onChange={(e) =>
                    patchIn('syslog', {
                      format: e.currentTarget.value as TriggerForm['syslog']['format'],
                    })
                  }
                >
                  {SYSLOG_FORMATS.map((v) => (
                    <option key={v} value={v}>
                      {v.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('triggers.editor.syslog.facility')} htmlFor="trigger-syslog-facility">
                <select
                  id="trigger-syslog-facility"
                  className="field"
                  value={form.syslog.facility}
                  onChange={(e) =>
                    patchIn('syslog', {
                      facility: e.currentTarget.value as TriggerForm['syslog']['facility'],
                    })
                  }
                >
                  {SYSLOG_FACILITIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('triggers.editor.syslog.appName')} htmlFor="trigger-syslog-app">
                <input
                  id="trigger-syslog-app"
                  className="field font-mono"
                  type="text"
                  value={form.syslog.app_name}
                  onChange={(e) => patchIn('syslog', { app_name: e.currentTarget.value })}
                />
              </Field>
            </div>
            <Field label={t('triggers.editor.syslog.message')} htmlFor="trigger-syslog-message">
              <textarea
                id="trigger-syslog-message"
                className="field min-h-[72px] font-mono"
                value={form.syslog.message}
                onChange={(e) => patchIn('syslog', { message: e.currentTarget.value })}
              />
            </Field>
            <div>
              <span className="label">{t('triggers.editor.syslog.severities')}</span>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('triggers.editor.syslog.event')}</th>
                      <th>{t('triggers.editor.syslog.severity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(DEFAULT_SYSLOG_SEVERITIES).map((key) => (
                      <tr key={key}>
                        <td>
                          <div className="row-title">{eventLabel(key)}</div>
                          <div className="row-sub font-mono">{key}</div>
                        </td>
                        <td>
                          <select
                            className="field h-[30px] w-auto"
                            aria-label={`${t('triggers.editor.syslog.severity')}: ${eventLabel(key)}`}
                            value={form.syslog.severities[key] ?? DEFAULT_SYSLOG_SEVERITIES[key]}
                            onChange={(e) =>
                              patchIn('syslog', {
                                severities: {
                                  ...form.syslog.severities,
                                  [key]: e.currentTarget.value as SyslogSeverity,
                                },
                              })
                            }
                          >
                            {SYSLOG_SEVERITIES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        <VariablesHelp />

        <div>
          <span className="label">{t('triggers.editor.delivery.title')}</span>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                [
                  'max_retries',
                  TRIGGER_LIMITS.maxRetries,
                  t('triggers.editor.delivery.maxRetries'),
                ],
                [
                  'retry_delay_seconds',
                  TRIGGER_LIMITS.retryDelaySeconds,
                  t('triggers.editor.delivery.retryDelay'),
                ],
                [
                  'timeout_seconds',
                  TRIGGER_LIMITS.timeoutSeconds,
                  t('triggers.editor.delivery.timeout'),
                ],
              ] as const
            ).map(([key, bounds, label]) => (
              <Field
                key={key}
                label={label}
                htmlFor={`trigger-${key}`}
                error={errors[key]}
                hint={t('triggers.editor.delivery.range', { min: bounds.min, max: bounds.max })}
              >
                <input
                  id={`trigger-${key}`}
                  className="field font-mono"
                  type="number"
                  min={bounds.min}
                  max={bounds.max}
                  value={form[key]}
                  onChange={(e) => patch(key, e.currentTarget.value)}
                />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <span className="label">{t('triggers.editor.workspaceEvents.title')}</span>
          <div className="flex flex-wrap gap-4">
            {WORKSPACE_TRIGGER_EVENTS.map((event) => (
              <label key={event} className="check">
                <input
                  type="checkbox"
                  checked={form.workspace_events.includes(event)}
                  onChange={(e) =>
                    patch(
                      'workspace_events',
                      e.currentTarget.checked
                        ? [...form.workspace_events, event]
                        : form.workspace_events.filter((x) => x !== event),
                    )
                  }
                />
                {eventLabel(event)}
              </label>
            ))}
          </div>
          <p className="hint">{t('triggers.editor.workspaceEvents.hint')}</p>
        </div>
      </fieldset>

      {testResult ? (
        <div className="mt-4">
          <TriggerTestResultView result={testResult} />
        </div>
      ) : null}

      {!readOnly ? (
        <div className="actions">
          {trigger ? (
            <Button
              variant="ghost"
              size="sm"
              busy={testing}
              title={t('triggers.editor.testHint')}
              onClick={() => void handleTest()}
            >
              {t('triggers.editor.sendTest')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" busy={saving} onClick={() => void handleSave()}>
            {isCreate ? t('triggers.editor.createSubmit') : t('common.saveChanges')}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

const PROVIDER_NAMES: Record<string, string> = {
  resend: 'Resend',
  mailgun: 'Mailgun',
  sendgrid: 'SendGrid',
};

function HeaderEditor({
  form,
  readOnly,
  error,
  onChange,
}: {
  form: TriggerForm;
  readOnly: boolean;
  error?: string;
  onChange: (headers: TriggerForm['webhook']['headers']) => void;
}) {
  const headers = form.webhook.headers;
  const update = (index: number, value: Partial<(typeof headers)[number]>) =>
    onChange(headers.map((h, i) => (i === index ? { ...h, ...value } : h)));
  return (
    <div>
      <span className="label">{t('triggers.editor.webhook.headers')}</span>
      <div className="flex flex-col gap-2">
        {headers.length === 0 ? (
          <p className="text-sm text-muted">{t('triggers.editor.webhook.noHeaders')}</p>
        ) : null}
        {headers.map((h, index) => {
          const keeps = !!h.storedName && h.storedName === h.name.trim();
          return (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <input
                className="field font-mono"
                type="text"
                aria-label={t('triggers.editor.webhook.headerName')}
                placeholder={t('triggers.editor.webhook.headerName')}
                value={h.name}
                onChange={(e) => update(index, { name: e.currentTarget.value })}
              />
              <input
                className="field font-mono"
                type="password"
                autoComplete="new-password"
                aria-label={t('triggers.editor.webhook.headerValue')}
                placeholder={
                  keeps
                    ? (h.hint ?? t('triggers.editor.webhook.headerKeep'))
                    : t('triggers.editor.webhook.headerValue')
                }
                title={keeps ? t('triggers.editor.secretKeep') : undefined}
                value={h.value}
                onChange={(e) => update(index, { value: e.currentTarget.value })}
              />
              <IconButton
                label={t('triggers.editor.webhook.removeHeader')}
                disabled={readOnly}
                onClick={() => onChange(headers.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            </div>
          );
        })}
        {error ? (
          <p className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
        {!readOnly ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange([...headers, { storedName: null, hint: null, name: '', value: '' }])
              }
            >
              <Plus aria-hidden="true" />
              {t('triggers.editor.webhook.addHeader')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Collapsible list of template variables; a click copies `{{name}}`. */
function VariablesHelp() {
  const copy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(`{{${name}}}`);
      toast.success(t('common.copiedToClipboard'));
    } catch {
      // clipboard blocked: nothing to do
    }
  };
  return (
    <details className="well">
      <summary className="cursor-pointer text-[13px] font-medium text-ink">
        {t('triggers.editor.variables.title')}
      </summary>
      <p className="hint mb-2">{t('triggers.editor.variables.hint')}</p>
      <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
        {TRIGGER_VARIABLES.map((v) => (
          <li key={v.name} className="min-w-0">
            <button
              type="button"
              className="flex w-full min-w-0 flex-col items-start rounded-control px-1.5 py-1 text-left hover:bg-s3"
              onClick={() => void copy(v.name)}
            >
              <code className="font-mono text-xs text-ink">{`{{${v.name}}}`}</code>
              <span className="truncate text-xs text-muted">
                {v.events === 'all'
                  ? t('triggers.editor.variables.allEvents')
                  : v.events.map((e) => eventLabel(e)).join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
