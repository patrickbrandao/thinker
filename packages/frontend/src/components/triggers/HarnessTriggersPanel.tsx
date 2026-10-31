import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Trash2, Zap } from 'lucide-react';
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
import { eventLabel } from './trigger-form.js';

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
                  {canEdit ? (
                    <IconButton
                      label={t('triggers.harness.remove', { name })}
                      onClick={() =>
                        setDraft((list) => list.filter((b) => b.trigger_id !== binding.trigger_id))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  ) : null}
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

      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {available.length > 0 ? (
            <select
              className="field w-auto min-w-[200px]"
              aria-label={t('triggers.harness.addLabel')}
              value=""
              onChange={(e) => {
                const id = e.currentTarget.value;
                if (!id) return;
                setDraft((list) => [...list, { trigger_id: id, events: DEFAULT_BINDING_EVENTS }]);
              }}
            >
              <option value="">{t('triggers.harness.addPlaceholder')}</option>
              {available.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
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
