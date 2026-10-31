import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FlaskConical, Plus, Trash2, Zap } from 'lucide-react';
import { HARNESS_TRIGGER_EVENTS, type HarnessTriggerEvent } from 'thinker-shared';
import { t } from '../../i18n/index.js';
import { toast } from '../../services/toast-store.js';
import {
  setHarnessTriggers,
  type HarnessTriggerBinding,
  type TriggerView,
} from '../../services/api/triggers.js';
import { Badge, Button, IconButton, Panel } from '../ui.js';
import { TriggerTypeIcon } from './TriggerParts.js';
import { eventLabel, providerOf, triggerTestPath, triggerTypeLabel } from './trigger-form.js';

/** Events a newly added trigger starts with: everything but the per-request debug event. */
export const DEFAULT_BINDING_EVENTS: HarnessTriggerEvent[] = HARNESS_TRIGGER_EVENTS.filter(
  (e) => e !== 'request.debug',
);

function sameBindings(a: HarnessTriggerBinding[], b: HarnessTriggerBinding[]): boolean {
  const norm = (list: HarnessTriggerBinding[]) =>
    JSON.stringify(
      [...list]
        .map((x) => ({ id: x.trigger_id, events: [...x.events].sort() }))
        .sort((x, y) => x.id.localeCompare(y.id)),
    );
  return norm(a) === norm(b);
}

/**
 * The harness side of triggers: which workspace triggers receive this
 * harness's events, and which events each one gets. Saved with one PUT.
 */
export default function HarnessTriggersPanel({
  agentName,
  triggers,
  bindings,
  loading,
  canEdit,
  onSaved,
}: {
  agentName: string;
  triggers: TriggerView[] | undefined;
  bindings: HarnessTriggerBinding[] | undefined;
  loading: boolean;
  canEdit: boolean;
  onSaved: (bindings: HarnessTriggerBinding[]) => void;
}) {
  const [draft, setDraft] = useState<HarnessTriggerBinding[]>(bindings ?? []);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    setDraft(bindings ?? []);
  }, [bindings]);

  const byId = useMemo(() => new Map((triggers ?? []).map((tr) => [tr.id, tr])), [triggers]);
  const available = (triggers ?? []).filter((tr) => !draft.some((b) => b.trigger_id === tr.id));
  const dirty = !sameBindings(draft, bindings ?? []);

  const toggleEvent = (triggerId: string, event: HarnessTriggerEvent, on: boolean) =>
    setDraft((list) =>
      list.map((b) =>
        b.trigger_id !== triggerId
          ? b
          : {
              ...b,
              events: on
                ? HARNESS_TRIGGER_EVENTS.filter((e) => e === event || b.events.includes(e))
                : b.events.filter((e) => e !== event),
            },
      ),
    );

  const save = async () => {
    setSaving(true);
    try {
      const saved = await setHarnessTriggers(agentName, draft);
      onSaved(saved);
      toast.success(t('triggers.toast.bindingsSaved'));
    } catch {
      // toasted (400 messages included)
    } finally {
      setSaving(false);
    }
  };

  const addPicked = () => {
    setDraft((list) => [
      ...list,
      ...picked
        .filter((id) => !list.some((b) => b.trigger_id === id))
        .map((id) => ({ trigger_id: id, events: DEFAULT_BINDING_EVENTS })),
    ]);
    setPicked([]);
    setPicking(false);
  };

  const noTriggers = !loading && triggers !== undefined && triggers.length === 0;

  return (
    <Panel
      title={t('triggers.harness.title')}
      icon={<Zap aria-hidden="true" className="size-4 text-muted" />}
      actions={
        <Link to="/triggers" className="text-xs text-accent">
          {t('triggers.harness.manage')}
        </Link>
      }
      bodyClassName="flex flex-col gap-3"
    >
      <p className="text-sm text-muted">{t('triggers.harness.description')}</p>

      {noTriggers && draft.length === 0 ? (
        <p className="text-sm text-dim">
          {t('triggers.harness.empty')}{' '}
          <Link to="/triggers" className="text-accent">
            {t('triggers.harness.emptyLink')}
          </Link>
        </p>
      ) : loading && draft.length === 0 ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : draft.length === 0 ? (
        <p className="text-sm text-dim">{t('triggers.harness.noneBound')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {draft.map((binding) => {
            const trigger = byId.get(binding.trigger_id);
            const name = trigger?.name ?? t('triggers.harness.missing');
            return (
              <li key={binding.trigger_id} className="well flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {trigger ? <TriggerTypeIcon type={trigger.type} /> : null}
                    <span className="truncate text-[13px] font-medium text-ink">{name}</span>
                    {trigger && !trigger.enabled ? (
                      <Badge tone="warn">{t('triggers.harness.disabled')}</Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {trigger ? (
                      <Link
                        to={triggerTestPath(trigger.id, agentName)}
                        className="icon-btn"
                        aria-label={t('triggers.harness.test', { name })}
                        title={t('triggers.harness.test', { name })}
                      >
                        <FlaskConical aria-hidden="true" />
                      </Link>
                    ) : null}
                    {canEdit ? (
                      <IconButton
                        label={t('triggers.harness.remove', { name })}
                        onClick={() =>
                          setDraft((list) =>
                            list.filter((b) => b.trigger_id !== binding.trigger_id),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {HARNESS_TRIGGER_EVENTS.map((event) => (
                    <label key={event} className="check">
                      <input
                        type="checkbox"
                        checked={binding.events.includes(event)}
                        disabled={!canEdit}
                        aria-label={`${name}: ${eventLabel(event)}`}
                        onChange={(e) =>
                          toggleEvent(binding.trigger_id, event, e.currentTarget.checked)
                        }
                      />
                      {eventLabel(event)}
                      {event === 'request.debug' ? (
                        <span className="text-xs text-muted">
                          ({t('triggers.harness.debugHint')})
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && picking && available.length > 0 ? (
        <div
          className="well flex flex-col gap-2"
          role="group"
          aria-label={t('triggers.harness.addLabel')}
        >
          <span className="label m-0">{t('triggers.harness.pickTitle')}</span>
          {available.map((tr) => (
            <label key={tr.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(tr.id)}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setPicked((list) => (on ? [...list, tr.id] : list.filter((id) => id !== tr.id)));
                }}
              />
              <TriggerTypeIcon type={tr.type} />
              {tr.name}
              <span className="text-xs text-muted">
                {triggerTypeLabel(tr.type, providerOf(tr))}
              </span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={picked.length === 0} onClick={addPicked}>
              {t('triggers.harness.addPicked', picked.length)}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {available.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={picking}
              onClick={() => {
                setPicked([]);
                setPicking(!picking);
              }}
            >
              <Plus aria-hidden="true" />
              {t('triggers.harness.add')}
            </Button>
          ) : (
            <span />
          )}
          <Button size="sm" disabled={!dirty} busy={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      ) : (
        <p className="hint">{t('triggers.harness.readOnly')}</p>
      )}
    </Panel>
  );
}
