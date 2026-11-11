import { useCallback, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import ErrorState from '../components/ErrorState.js';
import ApiKeysPanel from '../components/ApiKeysPanel.js';
import { ApiError } from '../services/api/core.js';
import { Badge, Button, Field, Modal, Panel, Tabs, type TabItem } from '../components/ui.js';
import { retentionOptions } from '../components/LogRetentionSelect.js';
import {
  addMember,
  deleteOrganization,
  listAdminUsers,
  listMembers,
  removeMember,
  renameOrganization,
  type OrgRole,
  getLogRetention,
  updateLogRetention,
} from '../services/api/organizations.js';
import { setActiveOrganizationId } from '../services/org-context.js';
import { assignableRoles, canEditMember, roleLabel } from '../services/permissions.js';
import { me, roleCan, setMe } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

type OrgTab = 'general' | 'retention' | 'apiKeys' | 'members' | 'danger';

/**
 * Settings of the active organization, one tab per section: name, log
 * retention, API keys, members and deletion. Owners rename/delete; owners and
 * admins add existing accounts as members or remove them (admins never touch
 * owners); everyone else gets a read-only view. Accounts are created only by
 * a superuser on the Users page.
 */
export default function Organization() {
  const profile = useSignal(me);
  const org = profile?.organization ?? null;
  const orgId = org?.id;
  const role = org?.role ?? null;
  const canManageOrg = roleCan.manageOrganization();
  const canManageMembers = roleCan.manageMembers();

  const members = useResource(async () => (await listMembers(orgId!)).members, [orgId], {
    enabled: !!orgId,
  });
  // Superusers see every account, so they get suggestions of who isn't a member yet.
  const accounts = useResource(async () => (await listAdminUsers()).users, [], {
    enabled: canManageMembers && profile?.isInstanceAdmin === true,
  });

  const tabs: TabItem<OrgTab>[] = [
    { key: 'general', label: t('org.page.general') },
    { key: 'retention', label: t('org.page.logRetention') },
    ...(canManageMembers && orgId
      ? [{ key: 'apiKeys' as const, label: t('org.apiKeys.title') }]
      : []),
    { key: 'members', label: t('org.page.members'), count: members.data?.length },
    ...(canManageOrg ? [{ key: 'danger' as const, label: t('org.page.dangerZone') }] : []),
  ];
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: OrgTab = tabs.some((i) => i.key === requested) ? (requested as OrgTab) : 'general';
  const switchTab = (next: OrgTab) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'general') params.delete('tab');
        else params.set('tab', next);
        return params;
      },
      { replace: true },
    );

  // ── Rename ───────────────────────────────────────────
  const [name, setName] = useState(org?.name ?? '');
  const [renaming, setRenaming] = useState(false);
  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!org || !trimmed || trimmed === org.name) return;
    setRenaming(true);
    try {
      const res = await renameOrganization(org.id, trimmed);
      const m = me();
      if (m?.organization) setMe({ ...m, organization: { ...m.organization, name: res.name } });
      toast.success(t('org.page.renamed'));
    } catch {
      // toasted by fetchMutate
    } finally {
      setRenaming(false);
    }
  };

  // ── Log retention ────────────────────────────────────
  const retention = useResource(() => getLogRetention(orgId!), [orgId], { enabled: !!orgId });
  const [savingRetention, setSavingRetention] = useState(false);
  const changeRetention = async (days: number | null) => {
    if (!orgId) return;
    setSavingRetention(true);
    try {
      retention.setData(await updateLogRetention(orgId, days));
      toast.success(t('harnesses.retention.savedToast'));
    } catch {
      // toasted by fetchMutate
    } finally {
      setSavingRetention(false);
    }
  };

  // ── Delete ───────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const closeDelete = useCallback(() => setDeleteOpen(false), []);
  const handleDelete = async () => {
    if (!org || deleteConfirm !== org.name) return;
    setDeleting(true);
    try {
      await deleteOrganization(org.id);
      setActiveOrganizationId(null);
      window.location.assign('/');
    } catch {
      setDeleting(false);
    }
  };

  // ── Members ──────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<OrgRole>('member');
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setAdding(true);
    try {
      const res = await addMember(org.id, { email: email.trim(), role: newRole }, { silent: true });
      toast.success(t('org.page.memberAdded', { email: res.member.email }));
      setEmail('');
      setNewRole('member');
      await members.reload();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      toast.error(
        status === 404
          ? t('org.page.accountNotFound')
          : status === 409
            ? t('org.page.alreadyMember')
            : (err as Error).message,
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!org) return;
    setBusyMember(userId);
    try {
      await removeMember(org.id, userId);
      setConfirmRemove(null);
      if (userId === me()?.userId) {
        setActiveOrganizationId(null);
        window.location.assign('/');
        return;
      }
    } catch {
      // toasted (e.g. 409 when removing the last owner)
    } finally {
      setBusyMember(null);
      await members.reload();
    }
  };

  const roleOptions = assignableRoles(role);
  const memberIds = new Set((members.data ?? []).map((m) => m.userId));
  const candidates = (accounts.data ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('org.page.title') })}</title>
      <meta name="description" content={t('org.page.metaDescription')} />

      <Tabs items={tabs} value={tab} onChange={switchTab} label={t('org.page.title')} />

      <div className="flex flex-col gap-4">
        {tab === 'general' ? (
          <Panel title={t('org.page.general')}>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleRename}>
              <Field
                className="min-w-[220px] flex-1"
                label={t('org.gate.orgName')}
                hint={canManageOrg ? t('org.page.nameDesc') : t('org.page.nameReadOnly')}
                htmlFor="org-name"
              >
                <input
                  id="org-name"
                  className="field"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={!canManageOrg}
                  required
                />
              </Field>
              {canManageOrg ? (
                <Button
                  type="submit"
                  className="mb-[22px]"
                  disabled={renaming || !name.trim() || name.trim() === org?.name}
                >
                  {t('common.save')}
                </Button>
              ) : null}
            </form>
          </Panel>
        ) : null}

        {tab === 'retention' ? (
          <Panel title={t('org.page.logRetention')}>
            <Field
              className="max-w-[320px]"
              label={t('org.page.logRetention')}
              hint={
                canManageOrg ? t('org.page.logRetentionDesc') : t('org.page.logRetentionReadOnly')
              }
              htmlFor="org-log-retention"
            >
              <select
                id="org-log-retention"
                className="field"
                value={retention.data?.retention_days ?? ''}
                disabled={!canManageOrg || savingRetention || !retention.data}
                onChange={(e) =>
                  void changeRetention(e.currentTarget.value ? Number(e.currentTarget.value) : null)
                }
              >
                <option value="">
                  {t('org.page.logRetentionDefault')}
                  {retention.data
                    ? ` (${t('harnesses.retention.days', retention.data.default_days)})`
                    : ''}
                </option>
                {retentionOptions(retention.data?.retention_days).map((days) => (
                  <option key={days} value={days}>
                    {t('harnesses.retention.days', days)}
                  </option>
                ))}
              </select>
            </Field>
          </Panel>
        ) : null}

        {tab === 'apiKeys' && canManageMembers && orgId ? <ApiKeysPanel orgId={orgId} /> : null}

        {tab === 'members' ? (
          <Panel title={t('org.page.members')} bodyClassName="flex flex-col gap-4">
            {canManageMembers ? (
              <>
                <form
                  className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
                  onSubmit={handleAdd}
                  aria-label={t('org.page.addMember')}
                >
                  <Field label={t('org.page.existingAccount')} htmlFor="org-add-email">
                    <input
                      id="org-add-email"
                      className="field"
                      type="email"
                      list={candidates.length > 0 ? 'org-add-candidates' : undefined}
                      placeholder={t('common.email')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    {candidates.length > 0 ? (
                      <datalist id="org-add-candidates">
                        {candidates.map((u) => (
                          <option key={u.id} value={u.email}>
                            {u.name}
                          </option>
                        ))}
                      </datalist>
                    ) : null}
                  </Field>
                  <Field label={t('common.role')} htmlFor="org-add-role">
                    <select
                      id="org-add-role"
                      className="field"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as OrgRole)}
                    >
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit" busy={adding}>
                    {t('org.page.addMember')}
                  </Button>
                </form>
                <p className="hint -mt-2">{t('org.page.existingAccountHint')}</p>
              </>
            ) : null}

            {members.error ? (
              <ErrorState error={members.error} onRetry={() => void members.reload()} />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('org.page.member')}</th>
                      <th>{t('common.role')}</th>
                      <th>{t('common.status')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {members.loading && !members.data ? (
                      <tr>
                        <td colSpan={4} className="text-muted">
                          {t('org.page.loadingMembers')}
                        </td>
                      </tr>
                    ) : null}
                    {(members.data ?? []).map((member) => {
                      const editable = canManageMembers && canEditMember(role, member.role);
                      const isSelf = member.userId === profile?.userId;
                      return (
                        <tr key={member.userId}>
                          <td>
                            <div className="row-title">
                              {member.name || member.email}
                              {isSelf ? (
                                <span className="font-normal text-muted"> {t('org.page.you')}</span>
                              ) : null}
                            </div>
                            <div className="row-sub">{member.email}</div>
                          </td>
                          <td>
                            <Badge>{roleLabel(member.role)}</Badge>
                          </td>
                          <td>
                            {member.mustChangePassword ? (
                              <Badge tone="warn">{t('org.page.pendingPassword')}</Badge>
                            ) : (
                              <span className="text-muted">{t('org.page.active')}</span>
                            )}
                          </td>
                          <td>
                            {editable ? (
                              <div className="row-actions gap-1.5">
                                {confirmRemove === member.userId ? (
                                  <>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      disabled={busyMember === member.userId}
                                      onClick={() => void handleRemove(member.userId)}
                                    >
                                      {t('org.page.confirmRemove')}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setConfirmRemove(null)}
                                    >
                                      {t('common.cancel')}
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    variant="quiet"
                                    size="sm"
                                    onClick={() => setConfirmRemove(member.userId)}
                                  >
                                    {t('common.remove')}
                                  </Button>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === 'danger' && canManageOrg ? (
          <Panel title={<span className="text-danger">{t('org.page.dangerZone')}</span>}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">{t('org.page.deleteThis')}</div>
                <p className="hint">{t('org.page.deleteDesc')}</p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeleteConfirm('');
                  setDeleteOpen(true);
                }}
              >
                {t('org.page.deleteOrg')}
              </Button>
            </div>
          </Panel>
        ) : null}
      </div>

      <Modal
        open={deleteOpen}
        onClose={closeDelete}
        title={t('org.page.deleteNamed', { name: org?.name ?? '' })}
      >
        <p className="mb-3 text-sm text-dim">{t('org.page.deleteWarning')}</p>
        <label htmlFor="delete-org-confirm" className="label">
          {t('org.page.typeToConfirmBefore')} <strong className="text-ink">"{org?.name}"</strong>{' '}
          {t('org.page.typeToConfirmAfter')}
        </label>
        <input
          id="delete-org-confirm"
          className="field"
          type="text"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
        />
        <div className="actions">
          <Button variant="ghost" onClick={closeDelete}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={deleteConfirm !== org?.name}
            busy={deleting}
            onClick={() => void handleDelete()}
          >
            {t('org.page.deleteThis')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
