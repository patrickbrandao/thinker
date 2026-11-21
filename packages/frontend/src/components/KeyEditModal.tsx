import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import KeySecret from './KeySecret.js';
import { Button, Field, Modal, Switch } from './ui.js';
import { updateAgentKey, type AgentKeyView } from '../services/api/agent-keys.js';
import {
  ipAclEditPath,
  updateIpRestriction,
  type IpPrefixListView,
  type IpRestriction,
} from '../services/api/ip-prefix-lists.js';
import {
  DAY_MS,
  EXPIRY_PRESETS,
  MAX_EXPIRY_DAYS,
  dateInputValue,
  expiryFromDate,
  expiryInDays,
} from '../services/agent-key-utils.js';
import { formatDateTime } from '../services/formatters.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';

/** `keep`: no button picked, the current expiry stays; `never`: the expiry is cleared. */
export type Expiry =
  | { kind: 'keep' }
  | { kind: 'never' }
  | { kind: 'preset'; days: number }
  | { kind: 'custom'; date: string };

/** ISO expiry the picker stands for; null = keep, never, or an invalid date. */
export function expiryAt(expiry: Expiry, now = Date.now()): string | null {
  if (expiry.kind === 'keep' || expiry.kind === 'never') return null;
  return expiry.kind === 'preset'
    ? expiryInDays(expiry.days, now)
    : expiryFromDate(expiry.date, now);
}

/** Expiry presets, a custom date and (when editing) "never expires". */
export function ExpiryPicker({
  value,
  onChange,
  allowNever,
  idPrefix,
}: {
  value: Expiry;
  onChange: (next: Expiry) => void;
  allowNever?: boolean;
  idPrefix: string;
}) {
  const now = Date.now();
  const at = expiryAt(value, now);
  const dateInvalid = value.kind === 'custom' && !!value.date && !at;
  const radio = (on: boolean, label: string, next: Expiry) => (
    <button
      key={label}
      type="button"
      role="radio"
      aria-checked={on}
      aria-pressed={on}
      onClick={() => onChange(next)}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="label">{t('harnessKeys.create.expiry')}</span>
        <div
          className="segmented w-fit flex-wrap"
          role="radiogroup"
          aria-label={t('harnessKeys.create.expiry')}
        >
          {allowNever
            ? radio(value.kind === 'never', t('harnessKeys.edit.neverExpires'), { kind: 'never' })
            : null}
          {EXPIRY_PRESETS.map((d) =>
            radio(
              value.kind === 'preset' && value.days === d,
              t('harnessKeys.create.days', { n: d }),
              { kind: 'preset', days: d },
            ),
          )}
          {radio(value.kind === 'custom', t('harnessKeys.create.custom'), {
            kind: 'custom',
            date: dateInputValue(now + 30 * DAY_MS),
          })}
        </div>
      </div>
      {value.kind === 'custom' ? (
        <Field
          label={t('harnessKeys.create.customDate')}
          htmlFor={`${idPrefix}-date`}
          hint={t('harnessKeys.create.customHint')}
          error={dateInvalid ? t('harnessKeys.create.invalidDate') : undefined}
        >
          <input
            id={`${idPrefix}-date`}
            className="field w-auto"
            type="date"
            min={dateInputValue(now + DAY_MS)}
            max={dateInputValue(now + (MAX_EXPIRY_DAYS - 1) * DAY_MS)}
            value={value.date}
            onChange={(e) => onChange({ kind: 'custom', date: e.currentTarget.value })}
          />
        </Field>
      ) : null}
      {at ? <p className="m-0 text-xs text-muted">{formatDateTime(at)}</p> : null}
    </div>
  );
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Floating editor of one key: name, active, expiry (extra keys), source IP
 * restriction (admins and owners) and, for the primary key, its secret.
 */
export default function KeyEditModal({
  agentName,
  target,
  canManageIp,
  lists,
  listsLoading,
  onClose,
  onSaved,
}: {
  agentName: string;
  target: AgentKeyView | null;
  canManageIp: boolean;
  lists: IpPrefixListView[];
  listsLoading: boolean;
  onClose: () => void;
  onSaved: (key: AgentKeyView) => void;
}) {
  const [lastId, setLastId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [expiry, setExpiry] = useState<Expiry>({ kind: 'keep' });
  const [ip, setIp] = useState<IpRestriction>({ enabled: false, listIds: [] });
  const [saving, setSaving] = useState(false);
  if (target && target.id !== lastId) {
    setLastId(target.id);
    setName(target.name ?? '');
    setActive(target.status !== 'disabled');
    setExpiry(target.expiresAt ? { kind: 'keep' } : { kind: 'never' });
    setIp(target.ipRestriction);
  }

  const close = () => {
    setLastId(null);
    onClose();
  };

  const newExpiry = expiryAt(expiry);
  const expiryInvalid = (expiry.kind === 'preset' || expiry.kind === 'custom') && !newExpiry;
  const ipDirty =
    !!target &&
    (ip.enabled !== target.ipRestriction.enabled ||
      !sameIds(ip.listIds, target.ipRestriction.listIds));
  const needList = ip.enabled && ip.listIds.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || !name.trim() || expiryInvalid || needList) return;
    const patch: { name?: string; disabled?: boolean; expiresAt?: string | null } = {};
    if (name.trim() !== (target.name ?? '')) patch.name = name.trim();
    if (active !== (target.status !== 'disabled')) patch.disabled = !active;
    if (newExpiry) patch.expiresAt = newExpiry;
    else if (expiry.kind === 'never' && target.expiresAt) patch.expiresAt = null;
    setSaving(true);
    try {
      let key = target;
      if (Object.keys(patch).length > 0) {
        key = (await updateAgentKey(agentName, target.id, patch)).key;
      }
      if (canManageIp && ipDirty) {
        key = { ...key, ipRestriction: await updateIpRestriction(agentName, target.id, ip) };
      }
      toast.success(t('harnessKeys.toast.saved'));
      onSaved(key);
      close();
    } catch {
      // fetchMutate already shows the backend error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={target !== null} title={t('harnessKeys.edit.title')} onClose={close} wide>
      {target ? (
        <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)}>
          <div>
            <span className="label">{t('harnessKeys.edit.secret')}</span>
            <KeySecret
              agentName={agentName}
              keyId={target.id}
              keyPrefix={target.keyPrefix}
              recoverable={target.recoverable}
              block
            />
          </div>

          <Field label={t('harnessKeys.create.name')} htmlFor="agent-key-edit-name">
            <input
              id="agent-key-edit-name"
              className="field"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              required
            />
          </Field>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-ink">{t('harnessKeys.edit.active')}</div>
              <div className="text-xs text-muted">{t('harnessKeys.edit.activeHelp')}</div>
            </div>
            <Switch checked={active} onChange={setActive} label={t('harnessKeys.edit.active')} />
          </div>

          {target.isPrimary ? (
            <div>
              <span className="label">{t('harnessKeys.create.expiry')}</span>
              <p className="m-0 text-sm text-muted">{t('harnessKeys.edit.primaryNoExpiry')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="m-0 text-xs text-muted">
                {target.expiresAt
                  ? t('harnessKeys.edit.currentExpiry', { date: formatDateTime(target.expiresAt) })
                  : t('harnessKeys.edit.neverExpires')}
              </p>
              <ExpiryPicker
                value={expiry}
                onChange={setExpiry}
                allowNever
                idPrefix="agent-key-edit"
              />
            </div>
          )}

          {canManageIp ? (
            <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-line p-0 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-ink">{t('ipLists.restriction.toggle')}</div>
                  <div className="text-xs text-muted">{t('ipLists.restriction.help')}</div>
                </div>
                <Switch
                  checked={ip.enabled}
                  onChange={(enabled) => setIp((d) => ({ ...d, enabled }))}
                  label={t('ipLists.restriction.toggle')}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="label">{t('ipLists.restriction.lists')}</span>
                {listsLoading && lists.length === 0 ? (
                  <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
                ) : lists.length === 0 ? (
                  <p className="m-0 text-sm text-muted">{t('ipLists.restriction.noLists')}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {lists.map((list) => (
                      <li key={list.id} className="flex items-center gap-2 text-sm">
                        <input
                          id={`ip-list-${list.id}`}
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={ip.listIds.includes(list.id)}
                          onChange={(e) => {
                            const on = e.currentTarget.checked;
                            setIp((d) => ({
                              ...d,
                              listIds: on
                                ? [...d.listIds, list.id]
                                : d.listIds.filter((x) => x !== list.id),
                            }));
                          }}
                        />
                        <label htmlFor={`ip-list-${list.id}`} className="text-ink">
                          {list.name}
                        </label>
                        <Link
                          to={ipAclEditPath(list.id)}
                          className="text-xs text-muted hover:underline"
                        >
                          {t('ipLists.form.entriesCount', { count: list.entries.length })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {needList ? (
                <p className="m-0 text-[13px] text-warn" role="alert">
                  {t('ipLists.restriction.needList')}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <div className="actions flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              busy={saving}
              disabled={!name.trim() || expiryInvalid || needList}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
