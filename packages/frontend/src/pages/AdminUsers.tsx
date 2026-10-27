import { For, Show, createResource, createSignal, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import ErrorState from '../components/ErrorState.jsx';
import TemporaryPasswordBox from '../components/TemporaryPasswordBox.jsx';
import {
  createAdminUser,
  listAdminUsers,
  listOrganizations,
  resetUserPassword,
  setInstanceAdmin,
  type OrgRole,
} from '../services/api/organizations.js';
import { formatTimeAgo } from '../services/formatters.js';
import { ALL_ROLES, ROLE_LABELS } from '../services/permissions.js';
import { isInstanceAdmin, me } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import '../styles/organization.css';

/**
 * Instance-admin account management: every user with their organizations,
 * account creation, password reset and the instance-admin flag. Temporary
 * passwords are shown once and never stored.
 */
const AdminUsers: Component = () => {
  const [users, { refetch }] = createResource(
    () => isInstanceAdmin() || undefined,
    async () => (await listAdminUsers()).users,
  );
  const [orgs] = createResource(
    () => isInstanceAdmin() || undefined,
    async () => (await listOrganizations()).organizations,
  );

  const [email, setEmail] = createSignal('');
  const [name, setName] = createSignal('');
  const [makeAdmin, setMakeAdmin] = createSignal(false);
  const [orgId, setOrgId] = createSignal('');
  const [role, setRole] = createSignal<OrgRole>('member');
  const [creating, setCreating] = createSignal(false);
  const [tempPassword, setTempPassword] = createSignal<{ email: string; password: string } | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = createSignal<string | null>(null);
  const [busyUser, setBusyUser] = createSignal<string | null>(null);

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await createAdminUser({
        email: email().trim(),
        name: name().trim(),
        ...(makeAdmin() ? { isInstanceAdmin: true } : {}),
        ...(orgId() ? { organizationId: orgId(), role: role() } : {}),
      });
      setTempPassword({ email: res.user.email, password: res.temporaryPassword });
      setEmail('');
      setName('');
      setMakeAdmin(false);
      setOrgId('');
      setRole('member');
      await refetch();
    } catch {
      // toasted by fetchMutate
    } finally {
      setCreating(false);
    }
  };

  const handleReset = async (userId: string, userEmail: string) => {
    setBusyUser(userId);
    try {
      const res = await resetUserPassword(userId);
      setConfirmReset(null);
      setTempPassword({ email: userEmail, password: res.temporaryPassword });
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
      await refetch();
    } catch {
      // toasted by fetchMutate
    } finally {
      setBusyUser(null);
    }
  };

  const handleToggleAdmin = async (userId: string, next: boolean) => {
    setBusyUser(userId);
    try {
      await setInstanceAdmin(userId, next);
      toast.success(next ? 'Instance admin granted' : 'Instance admin revoked');
    } catch {
      // toasted by fetchMutate
    } finally {
      setBusyUser(null);
      await refetch();
    }
  };

  return (
    <div class="container--lg">
      <Title>Users - Thinker</Title>
      <Meta name="description" content="Manage the accounts of this Thinker instance." />
      <Show
        when={isInstanceAdmin()}
        fallback={
          <ErrorState
            title="Not available"
            message="Only instance administrators can manage user accounts."
          />
        }
      >
        <div class="page-header" style="border-bottom: none; padding-bottom: 0;">
          <div>
            <h1 class="page-header__title">Users</h1>
            <p class="page-header__subtitle">
              Every account on this Thinker instance. New accounts get a temporary password and must
              change it at the first sign-in.
            </p>
          </div>
        </div>

        <h2 class="settings-section__title">Create user</h2>
        <div class="settings-card">
          <form class="org-form" onSubmit={handleCreate} aria-label="Create user">
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
              Name
              <input
                class="auth-form__input"
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
              />
            </label>
            <label class="org-form__field">
              Organization (optional)
              <select
                class="org-select"
                value={orgId()}
                onChange={(e) => setOrgId(e.currentTarget.value)}
              >
                <option value="">None</option>
                <For each={orgs() ?? []}>{(o) => <option value={o.id}>{o.name}</option>}</For>
              </select>
            </label>
            <label class="org-form__field">
              Role
              <select
                class="org-select"
                value={role()}
                disabled={!orgId()}
                onChange={(e) => setRole(e.currentTarget.value as OrgRole)}
              >
                <For each={ALL_ROLES}>{(r) => <option value={r}>{ROLE_LABELS[r]}</option>}</For>
              </select>
            </label>
            <label class="org-form__field org-form__field--inline">
              <input
                type="checkbox"
                checked={makeAdmin()}
                onChange={(e) => setMakeAdmin(e.currentTarget.checked)}
              />
              Instance admin
            </label>
            <div class="org-form__actions">
              <button class="btn btn--primary btn--sm" type="submit" disabled={creating()}>
                Create user
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

        <h2 class="settings-section__title">All users</h2>
        <Show when={!users.error} fallback={<ErrorState error={users.error} onRetry={refetch} />}>
          <div class="panel org-table-wrap" style="padding: 0;">
            <table class="data-table org-table" style="width: 100%;">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Organizations</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Instance admin</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <Show when={users.loading && !users()}>
                  <tr>
                    <td colspan="6" class="org-table__muted">
                      Loading users...
                    </td>
                  </tr>
                </Show>
                <For each={users() ?? []}>
                  {(user) => {
                    const isSelf = () => user.id === me()?.userId;
                    return (
                      <tr>
                        <td>
                          <div style="font-weight: 500;">
                            {user.name || user.email}
                            <Show when={isSelf()}>
                              <span class="org-table__muted"> (you)</span>
                            </Show>
                          </div>
                          <div class="org-table__muted">{user.email}</div>
                        </td>
                        <td>
                          <Show
                            when={user.organizations.length > 0}
                            fallback={<span class="org-table__muted">None</span>}
                          >
                            <div class="org-table__orgs">
                              <For each={user.organizations}>
                                {(o) => (
                                  <span class="role-badge">
                                    {o.name} · {ROLE_LABELS[o.role]}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                        </td>
                        <td>
                          <Show
                            when={user.mustChangePassword}
                            fallback={<span class="org-table__muted">Active</span>}
                          >
                            <span class="role-badge role-badge--warning">
                              Pending password change
                            </span>
                          </Show>
                        </td>
                        <td class="org-table__muted">{formatTimeAgo(user.createdAt)}</td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Instance admin: ${user.email}`}
                            checked={user.isInstanceAdmin}
                            // Revoking your own flag would lock you out of this page.
                            disabled={isSelf() || busyUser() === user.id}
                            title={isSelf() ? 'You cannot revoke your own admin access' : undefined}
                            onChange={(e) =>
                              void handleToggleAdmin(user.id, e.currentTarget.checked)
                            }
                          />
                        </td>
                        <td class="org-table__actions">
                          <Show
                            when={confirmReset() === user.id}
                            fallback={
                              <button
                                type="button"
                                class="btn btn--outline btn--sm"
                                onClick={() => setConfirmReset(user.id)}
                              >
                                Reset password
                              </button>
                            }
                          >
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              disabled={busyUser() === user.id}
                              onClick={() => void handleReset(user.id, user.email)}
                            >
                              Confirm reset
                            </button>
                            <button
                              type="button"
                              class="btn btn--outline btn--sm"
                              onClick={() => setConfirmReset(null)}
                            >
                              Cancel
                            </button>
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
      </Show>
    </div>
  );
};

export default AdminUsers;
