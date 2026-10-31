import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FlaskConical, RotateCcw, Send } from 'lucide-react';
import { TRIGGER_EVENT_TYPES, type TriggerEventType } from 'thinker-shared';
import ErrorState from '../components/ErrorState.js';
import { TriggerTestResultView, TriggerTypeTag } from '../components/triggers/TriggerParts.js';
import {
  eventLabel,
  providerOf,
  sampleVars,
  triggerTypeLabel,
} from '../components/triggers/trigger-form.js';
import { Badge, Button, EmptyState, Field, Panel } from '../components/ui.js';
import { getAgents } from '../services/api/agents.js';
import {
  listTriggers,
  testTrigger,
  type EmailTriggerConfig,
  type SyslogTriggerConfig,
  type TelegramTriggerConfig,
  type TriggerTestResult,
  type TriggerView,
  type WebhookTriggerConfigView,
} from '../services/api/triggers.js';
import { roleCan } from '../services/session-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

interface AgentRow {
  agent_name: string;
  display_name?: string;
}

/** Where a trigger delivers, in one line, so the user knows where to look for the message. */
function destination(trigger: TriggerView): string {
  switch (trigger.type) {
    case 'email': {
      const config = trigger.config as EmailTriggerConfig;
      return config.to?.length ? config.to.join(', ') : t('triggers.test.ownerEmail');
    }
    case 'webhook': {
      const config = trigger.config as WebhookTriggerConfigView;
      return `${config.method} ${config.url}`;
    }
    case 'telegram': {
      const config = trigger.config as TelegramTriggerConfig;
      return `chat ${config.chat_id}${config.thread_id ? ` / thread ${config.thread_id}` : ''}`;
    }
    case 'syslog': {
      const config = trigger.config as SyslogTriggerConfig;
      return `${config.transport.toUpperCase()} ${config.host}:${config.port} (${config.format.toUpperCase()})`;
    }
    default:
      return '';
  }
}

/**
 * Trigger test screen (/triggers/test): pick a trigger and an event, edit the
 * simulated variables (prefilled with sample values) and deliver it once,
 * synchronously, to see the destination's answer.
 */
export default function TriggerTest() {
  const canManage = roleCan.manageProviders();
  const [params, setParams] = useSearchParams();
  const triggers = useResource(listTriggers, []);
  const agents = useResource(
    async () => ((await getAgents()) as { agents?: AgentRow[] } | null)?.agents ?? [],
    [],
  );

  const list = triggers.data ?? [];
  const triggerId = params.get('trigger') ?? list[0]?.id ?? '';
  const trigger = list.find((tr) => tr.id === triggerId) ?? null;
  const [event, setEvent] = useState<TriggerEventType>('test');
  const [harnessName, setHarnessName] = useState(params.get('harness') ?? '');
  const harness = (agents.data ?? []).find((a) => a.agent_name === harnessName);
  const defaults = useMemo(
    () =>
      sampleVars(
        event,
        harness
          ? { name: harness.agent_name, displayName: harness.display_name }
          : harnessName
            ? { name: harnessName }
            : undefined,
      ),
    [event, harness, harnessName],
  );
  const [vars, setVars] = useState<Record<string, string>>(defaults);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TriggerTestResult | null>(null);

  useEffect(() => setVars(defaults), [defaults]);
  useEffect(() => setResult(null), [triggerId]);

  const update = (key: 'trigger' | 'harness', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const send = async () => {
    if (!trigger) return;
    setSending(true);
    setResult(null);
    try {
      setResult(await testTrigger(trigger.id, { event_type: event, vars }));
    } catch {
      // toasted
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('triggers.test.title') })}</title>

      <Link to="/triggers" className="text-sm text-muted hover:text-ink">
        {t('triggers.test.back')}
      </Link>
      <h1 className="mt-2 flex items-center gap-2">
        <FlaskConical aria-hidden="true" className="size-5 text-muted" />
        {t('triggers.test.title')}
      </h1>
      <p className="mb-5 mt-1 max-w-3xl text-sm text-muted">{t('triggers.test.subtitle')}</p>

      {!canManage ? (
        <div className="notice is-info">
          <span>{t('triggers.test.readOnly')}</span>
        </div>
      ) : triggers.error ? (
        <ErrorState error={triggers.error} onRetry={() => void triggers.reload()} />
      ) : !triggers.loading && list.length === 0 ? (
        <EmptyState
          icon={<FlaskConical aria-hidden="true" />}
          title={t('triggers.test.emptyTitle')}
          description={t('triggers.test.emptyBody')}
        />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <Panel title={t('triggers.test.simulation')} bodyClassName="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('triggers.test.trigger')} htmlFor="test-trigger">
                <select
                  id="test-trigger"
                  className="field"
                  value={triggerId}
                  onChange={(e) => update('trigger', e.currentTarget.value)}
                >
                  {list.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.name} ({triggerTypeLabel(tr.type, providerOf(tr))})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('triggers.test.event')} htmlFor="test-event">
                <select
                  id="test-event"
                  className="field"
                  value={event}
                  onChange={(e) => setEvent(e.currentTarget.value as TriggerEventType)}
                >
                  {TRIGGER_EVENT_TYPES.map((ev) => (
                    <option key={ev} value={ev}>
                      {eventLabel(ev)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('triggers.test.harness')}
                htmlFor="test-harness"
                hint={t('triggers.test.harnessHint')}
              >
                <select
                  id="test-harness"
                  className="field"
                  value={harnessName}
                  onChange={(e) => {
                    setHarnessName(e.currentTarget.value);
                    update('harness', e.currentTarget.value);
                  }}
                >
                  <option value="">{t('triggers.test.sampleHarness')}</option>
                  {(agents.data ?? []).map((a) => (
                    <option key={a.agent_name} value={a.agent_name}>
                      {a.display_name || a.agent_name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="label m-0">{t('triggers.test.variables')}</span>
                <Button variant="quiet" size="sm" onClick={() => setVars(defaults)}>
                  <RotateCcw aria-hidden="true" />
                  {t('triggers.test.reset')}
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {Object.keys(defaults).map((name) => {
                  const long = name === 'event.message';
                  return (
                    <Field
                      key={name}
                      label={<span className="break-all font-mono">{`{{${name}}}`}</span>}
                      htmlFor={`test-var-${name}`}
                      className={long || name === 'event.title' ? 'md:col-span-2' : undefined}
                    >
                      {long ? (
                        <textarea
                          id={`test-var-${name}`}
                          className="field min-h-[72px]"
                          value={vars[name] ?? ''}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setVars((v) => ({ ...v, [name]: value }));
                          }}
                        />
                      ) : (
                        <input
                          id={`test-var-${name}`}
                          className="field"
                          type="text"
                          value={vars[name] ?? ''}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setVars((v) => ({ ...v, [name]: value }));
                          }}
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
              <p className="hint">{t('triggers.test.computedHint')}</p>
            </div>
          </Panel>

          <Panel title={t('triggers.test.delivery')} bodyClassName="flex flex-col gap-3">
            {trigger ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <TriggerTypeTag type={trigger.type} provider={providerOf(trigger)} />
                  {!trigger.enabled ? (
                    <Badge tone="warn">{t('triggers.test.disabled')}</Badge>
                  ) : null}
                </div>
                <div>
                  <div className="label">{t('triggers.test.destination')}</div>
                  <p className="m-0 break-all font-mono text-xs text-ink">{destination(trigger)}</p>
                </div>
                <Button busy={sending} onClick={() => void send()}>
                  <Send aria-hidden="true" />
                  {t('triggers.test.send', { event: eventLabel(event) })}
                </Button>
                {result ? (
                  <>
                    <TriggerTestResultView result={result} />
                    {result.success ? (
                      <p className="hint m-0">{t('triggers.test.checkDestination')}</p>
                    ) : null}
                  </>
                ) : sending ? (
                  <p className="m-0 text-sm text-muted">{t('triggers.testResult.sending')}</p>
                ) : (
                  <p className="hint m-0">{t('triggers.test.sendHint')}</p>
                )}
              </>
            ) : (
              <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
