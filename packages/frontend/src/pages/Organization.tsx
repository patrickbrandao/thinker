import { useCallback, useState, type FormEvent } from 'react';
import ErrorState from '../components/ErrorState.js';
import TemporaryPasswordBox from '../components/TemporaryPasswordBox.js';
import { Badge, Button, Field, Modal, Panel } from '../components/ui.js';
import {
  addMember,
  deleteOrganization,
  listMembers,
  removeMember,
  renameOrganization,
  updateMemberRole,
  type OrgRole,
} from '../services/api/organizations.js';
import { setActiveOrganizationId } from '../services/org-context.js';
import { assignableRoles, canEditMember, roleLabel } from '../services/permissions.js';
import { me, roleCan, setMe } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/**
 * Settings of the active organization: name, members and roles, and deletion.
 * Owners rename/delete; owners and admins manage members (admins never touch
 * owners); everyone else gets a read-only view.
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
  const [memberName, setMemberName] = useState('');
  const [newRole, setNewRole] = useState<OrgRole>('member');
  const [adding, setAdding] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setAdding(true);
    try {
      const trimmedName = memberName.trim();
      const res = await addMember(org.id, {
        email: email.trim(),
        ...(trimmedName ? { name: trimmedName } : {}),
        role: newRole,
      });
      if (res.temporaryPassword) {
        setTempPassword({ email: res.member.email, password: res.temporaryPassword });
      } else {
        setTempPassword(null);
        toast.success(t('org.page.existingAdded', { email: res.member.email }));
      }
      setEmail('');
      setMemberName('');
      setNewRole('member');
      await members.reload();
    } catch {
      // toasted by fetchMutate
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (userId: string, next: OrgRole) => {
    if (!org) return;
    setBusyMember(userId);
    try {
      await updateMemberRole(org.id, userId, next);
      if (userId === me()?.userId) {
        // Our own role changed: reload so the whole UI follows it.
        window.location.reload();
        return;
      }
    } catch {
      // toasted (e.g. 409 when demoting the last owner)
    } finally {
      setBusyMember(null);
      await members.reload();
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

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('org.page.title') })}</title>
      <meta name="description" content={t('org.page.metaDescription')} />

      <div className="flex flex-col gap-4">
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

        <Panel title={t('org.page.members')} bodyClassName="flex flex-col gap-4">
          {canManageMembers ? (
            <>
              <form
                className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end"
                onSubmit={handleAdd}
                aria-label={t('org.page.addMember')}
              >
                <Field label={t('common.email')} htmlFor="org-add-email">
                  <input
                    id="org-add-email"
                    className="field"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('org.page.nameNewAccounts')} htmlFor="org-add-name">
                  <input
                    id="org-add-name"
                    className="field"
                    type="text"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                  />
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
              {tempPassword ? (
                <TemporaryPasswordBox
                  email={tempPassword.email}
                  password={tempPassword.password}
                  onDismiss={() => setTempPassword(null)}
                />
              ) : null}
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
                          {editable ? (
                            <select
                              className="field h-[30px] w-auto"
                              aria-label={t('org.page.roleOf', { email: member.email })}
                              value={member.role}
                              disabled={busyMember === member.userId}
                              onChange={(e) =>
                                void handleRoleChange(member.userId, e.target.value as OrgRole)
                              }
                            >
                              {roleOptions.map((r) => (
                                <option key={r} value={r}>
                                  {roleLabel(r)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge>{roleLabel(member.role)}</Badge>
                          )}
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

        {canManageOrg ? (
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
