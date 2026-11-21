import { useState, type FormEvent } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import ActionMenu from './ActionMenu.js';
import KeyEditModal, { ExpiryPicker, expiryAt, type Expiry } from './KeyEditModal.js';
import CopyButton from './CopyButton.js';
import { Badge, Button, ConfirmDialog, Field, Modal, Panel } from './ui.js';
import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  rotateOneAgentKey,
  getAgentKeySecret,
  type AgentKeyStatus,
  type AgentKeyView,
} from '../services/api/agent-keys.js';
import { listIpPrefixLists } from '../services/api/ip-prefix-lists.js';
import { daysFromNow, isStaleKey } from '../services/agent-key-utils.js';
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

/** A new secret: the full key with a copy button (it can be shown again in the table). */
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
  const expiresAt = expiryAt(expiry);

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
        <ExpiryPicker value={expiry} onChange={setExpiry} idPrefix="agent-key" />
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

/**
 * API keys of a harness (API Keys tab), one table: the primary key is always
 * there and is only rotated; extra keys expire and can be rotated or removed
 * (revoked). Every key opens in an editor for its name, status, expiry and,
 * for admins and owners, its source IP restriction.
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
  const canManageIp = roleCan.manageProviders();
  const res = useResource(() => listAgentKeys(agentName), [agentName]);
  const ipLists = useResource(
    () => (canManageIp ? listIpPrefixLists() : Promise.resolve({ lists: [] })),
    [canManageIp],
  );
  const [editing, setEditing] = useState<AgentKeyView | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<AgentKeyView | null>(null);
  const [rotating, setRotating] = useState<AgentKeyView | null>(null);
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
    if (!rotating) return;
    const target = rotating;
    setBusy(true);
    try {
      const out = await rotateOneAgentKey(agentName, target.id);
      toast.success(t('harnessKeys.toast.rotated'));
      setRotating(null);
      setSecret({ title: t('harnessKeys.rotate.newTitle'), key: out.apiKey });
      if (target.isPrimary) onPrimaryRotated?.();
      void res.reload();
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  const listNames = new Map((ipLists.data?.lists ?? []).map((l) => [l.id, l.name]));
  const ipCell = (k: AgentKeyView) => {
    if (k.status === 'revoked') return <span className="text-muted">—</span>;
    if (!k.ipRestriction.enabled) {
      return <Badge tone="ok">{t('harnessKeys.anyIp')}</Badge>;
    }
    const names = k.ipRestriction.listIds.map((id) => listNames.get(id)).filter(Boolean);
    return (
      <>
        <Badge tone="warn">{t('harnessKeys.ipRestricted')}</Badge>
        <div className="row-sub">
          {names.length
            ? names.join(', ')
            : t('harnessKeys.ipLists', { count: k.ipRestriction.listIds.length })}
        </div>
      </>
    );
  };

  const copyKey = async (k: AgentKeyView) => {
    try {
      const { apiKey } = await getAgentKeySecret(agentName, k.id);
      if (!apiKey) return;
      await navigator.clipboard.writeText(apiKey);
      toast.success(t('harnessKeys.toast.copied'));
    } catch {
      toast.error(t('harnessKeys.toast.copyFailed'));
    }
  };

  const actionsFor = (k: AgentKeyView) => {
    if (k.status === 'revoked') return [];
    return [
      { label: t('harnessKeys.actions.edit'), onClick: () => setEditing(k) },
      ...(k.recoverable
        ? [{ label: t('harnessKeys.actions.copy'), onClick: () => void copyKey(k) }]
        : []),
      { label: t('harnessKeys.actions.rotate'), onClick: () => setRotating(k) },
      ...(k.isPrimary
        ? []
        : [
            { label: t('harnessKeys.actions.revoke'), onClick: () => setRevoking(k), danger: true },
          ]),
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
                <th>{t('harnessKeys.col.sourceIp')}</th>
                <th>{t('harnessKeys.col.created')}</th>
                <th>{t('harnessKeys.col.lastUsed')}</th>
                <th>{t('harnessKeys.col.expires')}</th>
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
                        {canEdit && k.status !== 'revoked' ? (
                          <button
                            type="button"
                            className="row-title text-left hover:underline"
                            onClick={() => setEditing(k)}
                          >
                            {keyName(k)}
                          </button>
                        ) : (
                          <span className="row-title">{keyName(k)}</span>
                        )}
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
                    <td className="max-w-[22rem]">
                      <span className="font-mono text-xs text-dim">{`${k.keyPrefix}…`}</span>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[k.status]}>
                        {t(`harnessKeys.status.${k.status}`)}
                      </Badge>
                    </td>
                    <td className="text-sm">{ipCell(k)}</td>
                    <td className="text-sm text-dim">{formatDateTime(k.createdAt)}</td>
                    <td className="text-sm text-dim">
                      {k.lastUsedAt ? (
                        <span title={formatDateTime(k.lastUsedAt)}>
                          {formatTimeAgo(k.lastUsedAt) ?? formatDateTime(k.lastUsedAt)}
                        </span>
                      ) : (
                        t('harnessKeys.neverUsed')
                      )}
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
      <KeyEditModal
        agentName={agentName}
        target={editing}
        canManageIp={canManageIp}
        lists={ipLists.data?.lists ?? []}
        listsLoading={ipLists.loading}
        onClose={() => setEditing(null)}
        onSaved={replace}
      />
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
        open={rotating !== null}
        title={
          rotating?.isPrimary
            ? t('harnessKeys.rotate.title')
            : t('harnessKeys.rotate.titleExtra', { name: rotating ? keyName(rotating) : '' })
        }
        message={
          rotating?.isPrimary ? t('harnessKeys.rotate.body') : t('harnessKeys.rotate.bodyExtra')
        }
        confirmLabel={t('harnessKeys.rotate.confirm')}
        danger
        busy={busy}
        onConfirm={() => void rotate()}
        onCancel={() => setRotating(null)}
      />
    </Panel>
  );
}
