import { useState, type FormEvent } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import ActionMenu from './ActionMenu.js';
import CopyButton from './CopyButton.js';
import { Badge, Button, ConfirmDialog, Field, Modal, Panel } from './ui.js';
import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  updateAgentKey,
  type AgentKeyStatus,
  type AgentKeyView,
} from '../services/api/agent-keys.js';
import { rotateAgentKey } from '../services/api/agents.js';
import {
  DAY_MS,
  EXPIRY_PRESETS,
  MAX_EXPIRY_DAYS,
  dateInputValue,
  daysFromNow,
  expiryFromDate,
  expiryInDays,
  isStaleKey,
} from '../services/agent-key-utils.js';
import { formatDateTime, formatTimeAgo } from '../services/formatters.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

const MAX_KEYS = 50;

const STATUS_TONE: Record<AgentKeyStatus, 'ok' | 'neutral' | 'warn' | 'danger'> = {
  active: 'ok',
  disabled: 'neutral',
  expired: 'warn',
  revoked: 'danger',
};

const keyName = (k: AgentKeyView) =>
  k.name || (k.isPrimary ? t('harnessKeys.primaryName') : t('harnessKeys.unnamed'));

function relativeDays(ts: string): string {
  const d = daysFromNow(ts);
  if (d === 0) return t('harnessKeys.today');
  return d > 0 ? t('harnessKeys.inDays', { n: d }) : t('harnessKeys.daysAgo', { n: -d });
}

/** A one-time secret: the full key with a copy button and the "shown once" warning. */
function SecretModal({
  title,
  secret,
  onClose,
}: {
  title: string;
  secret: string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={secret !== null} title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-warn">{t('harnessKeys.created.warning')}</p>
        <div className="flex items-center gap-2 rounded-control border border-line bg-sunken px-2.5 py-1.5">
          <code
            className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink"
            data-testid="new-agent-key"
          >
            {secret}
          </code>
          {secret ? <CopyButton text={secret} /> : null}
        </div>
        <div className="actions flex justify-end">
          <Button size="sm" onClick={onClose}>
            {t('harnessKeys.created.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type Expiry = { kind: 'preset'; days: number } | { kind: 'custom'; date: string };

function NewKeyModal({
  open,
  agentName,
  onClose,
  onCreated,
}: {
  open: boolean;
  agentName: string;
  onClose: () => void;
  onCreated: (apiKey: string) => void;
}) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<Expiry>({ kind: 'preset', days: 90 });
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const expiresAt =
    expiry.kind === 'preset' ? expiryInDays(expiry.days, now) : expiryFromDate(expiry.date, now);
  const dateInvalid = expiry.kind === 'custom' && !!expiry.date && !expiresAt;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !expiresAt) return;
    setBusy(true);
    try {
      const res = await createAgentKey(agentName, { name: name.trim(), expiresAt });
      toast.success(t('harnessKeys.toast.created'));
      setName('');
      setExpiry({ kind: 'preset', days: 90 });
      onCreated(res.apiKey);
    } catch {
      // toasted by fetchMutate (limit of 50 keys, validation)
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={t('harnessKeys.create.title')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field label={t('harnessKeys.create.name')} htmlFor="agent-key-name">
          <input
            id="agent-key-name"
            className="field"
            maxLength={100}
            autoComplete="off"
            placeholder={t('harnessKeys.create.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
        </Field>
        <div>
          <span className="label">{t('harnessKeys.create.expiry')}</span>
          <div
            className="segmented w-fit flex-wrap"
            role="radiogroup"
            aria-label={t('harnessKeys.create.expiry')}
          >
            {EXPIRY_PRESETS.map((d) => {
              const on = expiry.kind === 'preset' && expiry.days === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-pressed={on}
                  onClick={() => setExpiry({ kind: 'preset', days: d })}
                >
                  {t('harnessKeys.create.days', { n: d })}
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={expiry.kind === 'custom'}
              aria-pressed={expiry.kind === 'custom'}
              onClick={() => setExpiry({ kind: 'custom', date: dateInputValue(now + 30 * DAY_MS) })}
            >
              {t('harnessKeys.create.custom')}
            </button>
          </div>
        </div>
        {expiry.kind === 'custom' ? (
          <Field
            label={t('harnessKeys.create.customDate')}
            htmlFor="agent-key-date"
            hint={t('harnessKeys.create.customHint')}
            error={dateInvalid ? t('harnessKeys.create.invalidDate') : undefined}
          >
            <input
              id="agent-key-date"
              className="field w-auto"
              type="date"
              min={dateInputValue(now + DAY_MS)}
              max={dateInputValue(now + (MAX_EXPIRY_DAYS - 1) * DAY_MS)}
              value={expiry.date}
              onChange={(e) => setExpiry({ kind: 'custom', date: e.currentTarget.value })}
            />
          </Field>
        ) : null}
        {expiresAt ? <p className="m-0 text-xs text-muted">{formatDateTime(expiresAt)}</p> : null}
        <div className="actions flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" busy={busy} disabled={!name.trim() || !expiresAt}>
            {t('harnessKeys.create.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameModal({
  target,
  onClose,
  onSave,
}: {
  target: AgentKeyView | null;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (target && target.id !== lastId) {
    setLastId(target.id);
    setName(target.name ?? '');
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={target !== null} title={t('harnessKeys.rename.title')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field label={t('harnessKeys.create.name')} htmlFor="agent-key-rename">
          <input
            id="agent-key-rename"
            className="field"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
        </Field>
        <div className="actions flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" busy={busy} disabled={!name.trim()}>
            {t('harnessKeys.rename.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * API keys of a harness (Connection tab): the primary key plus extra keys
 * with an expiry. Members and up create, rename, disable and revoke them;
 * the primary key is rotated instead of revoked.
 */
export default function AgentKeysPanel({
  agentName,
  onPrimaryRotated,
}: {
  agentName: string;
  /** Called after the primary key rotates, so the setup snippets reload it. */
  onPrimaryRotated?: () => void;
}) {
  const canEdit = roleCan.editHarnesses();
  const res = useResource(() => listAgentKeys(agentName), [agentName]);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  const [renaming, setRenaming] = useState<AgentKeyView | null>(null);
  const [revoking, setRevoking] = useState<AgentKeyView | null>(null);
  const [rotating, setRotating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);

  const keys = res.data?.keys ?? [];
  const live = keys.filter((k) => k.status !== 'revoked');
  const revoked = keys.filter((k) => k.status === 'revoked');
  const shown = showRevoked ? [...live, ...revoked] : live;

  const replace = (key: AgentKeyView) =>
    res.setData((prev) =>
      prev ? { keys: prev.keys.map((k) => (k.id === key.id ? key : k)) } : prev,
    );

  const toggleDisabled = async (key: AgentKeyView) => {
    const disabled = key.status !== 'disabled';
    try {
      const out = await updateAgentKey(agentName, key.id, { disabled });
      replace(out.key);
      toast.success(disabled ? t('harnessKeys.toast.disabled') : t('harnessKeys.toast.enabled'));
    } catch {
      // toasted
    }
  };

  const rename = async (name: string) => {
    if (!renaming) return;
    try {
      const out = await updateAgentKey(agentName, renaming.id, { name });
      replace(out.key);
      toast.success(t('harnessKeys.toast.renamed'));
      setRenaming(null);
    } catch {
      // toasted
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      const out = await revokeAgentKey(agentName, revoking.id);
      replace(out.key);
      toast.success(t('harnessKeys.toast.revoked'));
      setRevoking(null);
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const out = await rotateAgentKey(agentName);
      toast.success(t('harnessKeys.toast.rotated'));
      setRotating(false);
      setSecret({ title: t('harnessKeys.rotate.newTitle'), key: out.apiKey });
      onPrimaryRotated?.();
      void res.reload();
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  const actionsFor = (k: AgentKeyView) => {
    if (k.status === 'revoked') return [];
    return [
      { label: t('harnessKeys.actions.rename'), onClick: () => setRenaming(k) },
      {
        label:
          k.status === 'disabled'
            ? t('harnessKeys.actions.enable')
            : t('harnessKeys.actions.disable'),
        onClick: () => void toggleDisabled(k),
      },
      k.isPrimary
        ? { label: t('harnessKeys.actions.rotate'), onClick: () => setRotating(true) }
        : { label: t('harnessKeys.actions.revoke'), onClick: () => setRevoking(k), danger: true },
    ];
  };

  return (
    <Panel
      title={t('harnessKeys.title')}
      icon={<KeyRound aria-hidden="true" className="size-4 text-muted" />}
      actions={
        canEdit ? (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={live.length >= MAX_KEYS}
            title={live.length >= MAX_KEYS ? t('harnessKeys.limit', { max: MAX_KEYS }) : undefined}
          >
            <Plus aria-hidden="true" />
            {t('harnessKeys.newKey')}
          </Button>
        ) : null
      }
      bodyClassName="flex flex-col gap-3"
    >
      <p className="m-0 text-sm text-dim">{t('harnessKeys.intro')}</p>
      {res.error ? (
        <div className="notice is-warn" role="alert">
          <span>{t('harnessKeys.loadError')}</span>
        </div>
      ) : res.loading && !res.data ? (
        <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
      ) : keys.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('harnessKeys.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('harnessKeys.col.name')}</th>
                <th>{t('harnessKeys.col.prefix')}</th>
                <th>{t('harnessKeys.col.status')}</th>
                <th>{t('harnessKeys.col.expires')}</th>
                <th>{t('harnessKeys.col.lastUsed')}</th>
                <th>{t('harnessKeys.col.created')}</th>
                {canEdit ? (
                  <th>
                    <span className="sr-only">{t('harnessKeys.col.actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((k) => {
                const items = canEdit ? actionsFor(k) : [];
                return (
                  <tr key={k.id} data-testid={`agent-key-${k.id}`}>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="row-title">{keyName(k)}</span>
                        {k.isPrimary ? (
                          <Badge tone="accent">{t('harnessKeys.primary')}</Badge>
                        ) : null}
                      </div>
                      {isStaleKey(k) ? (
                        <div className="row-sub text-warn" title={t('harnessKeys.unusedHint')}>
                          {t('harnessKeys.unused')}
                        </div>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs text-dim">{`${k.keyPrefix}…`}</td>
                    <td>
                      <Badge tone={STATUS_TONE[k.status]}>
                        {t(`harnessKeys.status.${k.status}`)}
                      </Badge>
                    </td>
                    <td className="text-sm">
                      {k.expiresAt ? (
                        <>
                          <div>{relativeDays(k.expiresAt)}</div>
                          <div className="row-sub">{formatDateTime(k.expiresAt)}</div>
                        </>
                      ) : (
                        <span className="text-muted">{t('harnessKeys.noExpiry')}</span>
                      )}
                    </td>
                    <td className="text-sm text-dim">
                      {k.lastUsedAt ? (
                        <span title={formatDateTime(k.lastUsedAt)}>
                          {formatTimeAgo(k.lastUsedAt) ?? formatDateTime(k.lastUsedAt)}
                        </span>
                      ) : (
                        t('harnessKeys.neverUsed')
                      )}
                    </td>
                    <td className="text-sm text-dim">{formatDateTime(k.createdAt)}</td>
                    {canEdit ? (
                      <td className="text-right">
                        {items.length ? (
                          <ActionMenu
                            items={items}
                            ariaLabel={t('harnessKeys.actions.menu', { name: keyName(k) })}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {revoked.length ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowRevoked((v) => !v)}>
            {showRevoked
              ? t('harnessKeys.hideRevoked')
              : t('harnessKeys.showRevoked', { count: revoked.length })}
          </Button>
        </div>
      ) : null}

      <NewKeyModal
        open={creating}
        agentName={agentName}
        onClose={() => setCreating(false)}
        onCreated={(apiKey) => {
          setCreating(false);
          setSecret({ title: t('harnessKeys.created.title'), key: apiKey });
          void res.reload();
        }}
      />
      <SecretModal
        title={secret?.title ?? ''}
        secret={secret?.key ?? null}
        onClose={() => setSecret(null)}
      />
      <RenameModal target={renaming} onClose={() => setRenaming(null)} onSave={rename} />
      <ConfirmDialog
        open={revoking !== null}
        title={t('harnessKeys.revoke.title')}
        message={t('harnessKeys.revoke.body', { name: revoking ? keyName(revoking) : '' })}
        confirmLabel={t('harnessKeys.revoke.confirm')}
        danger
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
      <ConfirmDialog
        open={rotating}
        title={t('harnessKeys.rotate.title')}
        message={t('harnessKeys.rotate.body')}
        confirmLabel={t('harnessKeys.rotate.confirm')}
        danger
        busy={busy}
        onConfirm={() => void rotate()}
        onCancel={() => setRotating(false)}
      />
    </Panel>
  );
}
