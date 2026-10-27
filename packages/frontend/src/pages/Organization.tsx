import { For, Show, createResource, createSignal, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import ErrorState from '../components/ErrorState.jsx';
import TemporaryPasswordBox from '../components/TemporaryPasswordBox.jsx';
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
import { ROLE_LABELS, assignableRoles, canEditMember } from '../services/permissions.js';
import { currentRole, me, roleCan, setMe } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import '../styles/organization.css';

/**
 * Settings of the active organization: name, members and roles, and deletion.
 * Owners rename/delete; owners and admins manage members (admins never touch
 * owners); everyone else gets a read-only view.
 */
const Organization: Component = () => {
  const org = () => me()?.organization ?? null;
  const [members, { refetch }] = createResource(
    () => org()?.id,
    async (id) => (await listMembers(id)).members,
  );

  // ── Rename ───────────────────────────────────────────
  const [name, setName] = createSignal(org()?.name ?? '');
  const [renaming, setRenaming] = createSignal(false);
  const handleRename = async (e: Event) => {
    e.preventDefault();
    const current = org();
    const trimmed = name().trim();
    if (!current || !trimmed || trimmed === current.name) return;
    setRenaming(true);
    try {
      const res = await renameOrganization(current.id, trimmed);
      const m = me();
      if (m?.organization) setMe({ ...m, organization: { ...m.organization, name: res.name } });
      toast.success('Organization renamed');
    } catch {
      // toasted by fetchMutate
    } finally {
      setRenaming(false);
    }
  };

  // ── Delete ───────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteConfirm, setDeleteConfirm] = createSignal('');
  const [deleting, setDeleting] = createSignal(false);
  const handleDelete = async () => {
    const current = org();
    if (!current || deleteConfirm() !== current.name) return;
    setDeleting(true);
    try {
      await deleteOrganization(current.id);
      setActiveOrganizationId(null);
      window.location.assign('/');
    } catch {
      setDeleting(false);
    }
  };

  // ── Members ──────────────────────────────────────────
  const [email, setEmail] = createSignal('');
  const [memberName, setMemberName] = createSignal('');
  const [role, setRole] = createSignal<OrgRole>('member');
  const [adding, setAdding] = createSignal(false);
  const [tempPassword, setTempPassword] = createSignal<{ email: string; password: string } | null>(
    null,
  );
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  const [busyMember, setBusyMember] = createSignal<string | null>(null);

  const handleAdd = async (e: Event) => {
    e.preventDefault();
    const current = org();
    if (!current) return;
    setAdding(true);
    try {
      const trimmedName = memberName().trim();
      const res = await addMember(current.id, {
        email: email().trim(),
        ...(trimmedName ? { name: trimmedName } : {}),
        role: role(),
      });
      if (res.temporaryPassword) {
        setTempPassword({ email: res.member.email, password: res.temporaryPassword });
      } else {
        setTempPassword(null);
        toast.success(`${res.member.email} already had an account and was added`);
      }
      setEmail('');
      setMemberName('');
      setRole('member');
      await refetch();
    } catch {
      // toasted by fetchMutate
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (userId: string, next: OrgRole) => {
    const current = org();
    if (!current) return;
    setBusyMember(userId);
    try {
      await updateMemberRole(current.id, userId, next);
      if (userId === me()?.userId) {
        // Our own role changed: reload so the whole UI follows it.
        window.location.reload();
        return;
      }
    } catch {
      // toasted (e.g. 409 when demoting the last owner)
    } finally {
      setBusyMember(null);
      await refetch();
    }
  };

  const handleRemove = async (userId: string) => {
    const current = org();
    if (!current) return;
    setBusyMember(userId);
    try {
      await removeMember(current.id, userId);
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
      await refetch();
    }
  };

  const roleOptions = () => assignableRoles(currentRole());

  return (
    <div class="container--md">
      <Title>Organization - Thinker</Title>
      <Meta name="description" content="Manage the organization's name and members." />
      <div class="page-header" style="border-bottom: none; padding-bottom: 0;">
        <div>
          <h1 class="page-header__title">{org()?.name ?? 'Organization'}</h1>
          <p class="page-header__subtitle">
            Members, roles and settings of this organization.
            <Show when={currentRole()}>{(r) => <> Your role: {ROLE_LABELS[r()]}.</>}</Show>
          </p>
        </div>
      </div>

      {/* ── General ─────────────────────────────────── */}
      <h2 class="settings-section__title">General</h2>
      <form class="settings-card" onSubmit={handleRename}>
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Organization name</span>
            <span class="settings-card__label-desc">
              {roleCan.manageOrganization()
                ? 'Shown in the organization switcher.'
                : 'Only owners can rename the organization.'}
            </span>
          </div>
          <div class="settings-card__control">
            <input
              class="settings-card__input"
              type="text"
              aria-label="Organization name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              readonly={!roleCan.manageOrganization()}
              required
            />
          </div>
        </div>
        <Show when={roleCan.manageOrganization()}>
          <div class="settings-card__footer" style="justify-content: flex-end;">
            <button
              class="btn btn--primary btn--sm"
              type="submit"
              disabled={renaming() || !name().trim() || name().trim() === org()?.name}
            >
              Save
            </button>
          </div>
        </Show>
      </form>

      {/* ── Members ─────────────────────────────────── */}
      <h2 class="settings-section__title">Members</h2>

      <Show when={roleCan.manageMembers()}>
        <div class="settings-card">
          <form class="org-form" onSubmit={handleAdd} aria-label="Add member">
            <label class="org-form__field">
              Email
              <input
                class="auth-form__input"
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
              />
            </label>
            <label class="org-form__field">
              Name (new accounts)
              <input
                class="auth-form__input"
                type="text"
                value={memberName()}
                onInput={(e) => setMemberName(e.currentTarget.value)}
              />
            </label>
            <label class="org-form__field">
              Role
              <select
                class="org-select"
                value={role()}
                onChange={(e) => setRole(e.currentTarget.value as OrgRole)}
              >
                <For each={roleOptions()}>{(r) => <option value={r}>{ROLE_LABELS[r]}</option>}</For>
              </select>
            </label>
            <div class="org-form__actions">
              <button class="btn btn--primary btn--sm" type="submit" disabled={adding()}>
                Add member
              </button>
            </div>
          </form>
          <Show when={tempPassword()}>
            {(tp) => (
              <div style="padding: 0 var(--gap-lg) var(--gap-lg);">
                <TemporaryPasswordBox
                  email={tp().email}
                  password={tp().password}
                  onDismiss={() => setTempPassword(null)}
                />
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show when={!members.error} fallback={<ErrorState error={members.error} onRetry={refetch} />}>
        <div class="panel org-table-wrap" style="padding: 0;">
          <table class="data-table org-table" style="width: 100%;">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <Show when={members.loading && !members()}>
                <tr>
                  <td colspan="4" class="org-table__muted">
                    Loading members...
                  </td>
                </tr>
              </Show>
              <For each={members() ?? []}>
                {(member) => {
                  const editable = () =>
                    roleCan.manageMembers() && canEditMember(currentRole(), member.role);
                  const isSelf = () => member.userId === me()?.userId;
                  return (
                    <tr>
                      <td>
                        <div style="font-weight: 500;">
                          {member.name || member.email}
                          <Show when={isSelf()}>
                            <span class="org-table__muted"> (you)</span>
                          </Show>
                        </div>
                        <div class="org-table__muted">{member.email}</div>
                      </td>
                      <td>
                        <Show
                          when={editable()}
                          fallback={<span class="role-badge">{ROLE_LABELS[member.role]}</span>}
                        >
                          <select
                            class="org-select"
                            aria-label={`Role of ${member.email}`}
                            value={member.role}
                            disabled={busyMember() === member.userId}
                            onChange={(e) =>
                              void handleRoleChange(member.userId, e.currentTarget.value as OrgRole)
                            }
                          >
                            <For each={roleOptions()}>
                              {(r) => <option value={r}>{ROLE_LABELS[r]}</option>}
                            </For>
                          </select>
                        </Show>
                      </td>
                      <td>
                        <Show
                          when={member.mustChangePassword}
                          fallback={<span class="org-table__muted">Active</span>}
                        >
                          <span class="role-badge role-badge--warning">
                            Pending password change
                          </span>
                        </Show>
                      </td>
                      <td class="org-table__actions">
                        <Show when={editable()}>
                          <Show
                            when={confirmRemove() === member.userId}
                            fallback={
                              <button
                                type="button"
                                class="btn btn--ghost btn--sm"
                                onClick={() => setConfirmRemove(member.userId)}
                              >
                                Remove
                              </button>
                            }
                          >
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              disabled={busyMember() === member.userId}
                              onClick={() => void handleRemove(member.userId)}
                            >
                              Confirm remove
                            </button>
                            <button
                              type="button"
                              class="btn btn--outline btn--sm"
                              onClick={() => setConfirmRemove(null)}
                            >
                              Cancel
                            </button>
                          </Show>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* ── Danger zone ─────────────────────────────── */}
      <Show when={roleCan.manageOrganization()}>
        <h2 class="settings-section__title settings-section__title--danger">Danger zone</h2>
        <div class="settings-card settings-card--danger">
          <div class="settings-card__row">
            <div class="settings-card__label">
              <span class="settings-card__label-title">Delete this organization</span>
              <span class="settings-card__label-desc">
                Permanently delete the organization with its harnesses, providers, routing and
                request logs. This action cannot be undone.
              </span>
            </div>
            <div class="settings-card__control">
              <button
                type="button"
                class="btn btn--danger btn--sm"
                onClick={() => {
                  setDeleteConfirm('');
                  setDeleteOpen(true);
                }}
              >
                Delete organization
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={deleteOpen()}>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeleteOpen(false);
          }}
        >
          <div
            class="modal-card"
            style="max-width: 440px;"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-org-title"
          >
            <h3
              id="delete-org-title"
              style="margin: 0 0 var(--gap-md); font-size: var(--font-size-lg);"
            >
              Delete {org()?.name}
            </h3>
            <p style="font-size: var(--font-size-sm); color: hsl(var(--muted-foreground)); margin-bottom: var(--gap-md);">
              Everything in this organization is deleted for all its members. This action cannot be
              undone.
            </p>
            <label
              for="delete-org-confirm"
              style="display: block; font-size: var(--font-size-sm); margin-bottom: var(--gap-sm);"
            >
              To confirm, type <strong>"{org()?.name}"</strong> in the box below
            </label>
            <input
              id="delete-org-confirm"
              class="auth-form__input"
              type="text"
              value={deleteConfirm()}
              onInput={(e) => setDeleteConfirm(e.currentTarget.value)}
              style="width: 100%; margin-bottom: var(--gap-lg);"
            />
            <div style="display: flex; justify-content: flex-end; gap: var(--gap-sm);">
              <button
                type="button"
                class="btn btn--outline btn--sm"
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn--danger btn--sm"
                disabled={deleteConfirm() !== org()?.name || deleting()}
                onClick={() => void handleDelete()}
              >
                Delete this organization
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Organization;
