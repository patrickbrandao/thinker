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
import { ALL_ROLES, roleLabel } from '../services/permissions.js';
import { isInstanceAdmin, me } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import '../styles/organization.css';
import { t } from '../i18n/index.js';

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
      toast.success(next ? t('org.users.adminGranted') : t('org.users.adminRevoked'));
    } catch {
      // toasted by fetchMutate
    } finally {
      setBusyUser(null);
      await refetch();
    }
  };

  return (
    <div class="container--lg">
      <Title>{t('common.pageTitle', { page: t('org.users.title') })}</Title>
      <Meta name="description" content={t('org.users.metaDescription')} />
      <Show
        when={isInstanceAdmin()}
        fallback={
          <ErrorState title={t('org.users.notAvailable')} message={t('org.users.adminsOnly')} />
        }
      >
        <div class="page-header" style="border-bottom: none; padding-bottom: 0;">
          <div>
            <h1 class="page-header__title">{t('org.users.title')}</h1>
            <p class="page-header__subtitle">{t('org.users.subtitle')}</p>
          </div>
        </div>

        <h2 class="settings-section__title">{t('org.users.create')}</h2>
        <div class="settings-card">
          <form class="org-form" onSubmit={handleCreate} aria-label={t('org.users.create')}>
            <label class="org-form__field">
              {t('common.email')}
              <input
                class="auth-form__input"
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
              />
            </label>
            <label class="org-form__field">
              {t('common.name')}
              <input
                class="auth-form__input"
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
              />
            </label>
            <label class="org-form__field">
              {t('org.users.orgOptional')}
              <select
                class="org-select"
                value={orgId()}
                onChange={(e) => setOrgId(e.currentTarget.value)}
              >
                <option value="">{t('common.none')}</option>
                <For each={orgs() ?? []}>{(o) => <option value={o.id}>{o.name}</option>}</For>
              </select>
            </label>
            <label class="org-form__field">
              {t('common.role')}
              <select
                class="org-select"
                value={role()}
                disabled={!orgId()}
                onChange={(e) => setRole(e.currentTarget.value as OrgRole)}
              >
                <For each={ALL_ROLES}>{(r) => <option value={r}>{roleLabel(r)}</option>}</For>
              </select>
            </label>
            <label class="org-form__field org-form__field--inline">
              <input
                type="checkbox"
                checked={makeAdmin()}
                onChange={(e) => setMakeAdmin(e.currentTarget.checked)}
              />
              {t('org.users.instanceAdmin')}
            </label>
            <div class="org-form__actions">
              <button class="btn btn--primary btn--sm" type="submit" disabled={creating()}>
                {t('org.users.create')}
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

        <h2 class="settings-section__title">{t('org.users.all')}</h2>
        <Show when={!users.error} fallback={<ErrorState error={users.error} onRetry={refetch} />}>
          <div class="panel org-table-wrap" style="padding: 0;">
            <table class="data-table org-table" style="width: 100%;">
              <thead>
                <tr>
                  <th>{t('org.users.user')}</th>
                  <th>{t('org.users.organizations')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('org.users.created')}</th>
                  <th>{t('org.users.instanceAdmin')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <Show when={users.loading && !users()}>
                  <tr>
                    <td colspan="6" class="org-table__muted">
                      {t('org.users.loading')}
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
                              <span class="org-table__muted"> {t('org.page.you')}</span>
                            </Show>
                          </div>
                          <div class="org-table__muted">{user.email}</div>
                        </td>
                        <td>
                          <Show
                            when={user.organizations.length > 0}
                            fallback={<span class="org-table__muted">{t('common.none')}</span>}
                          >
                            <div class="org-table__orgs">
                              <For each={user.organizations}>
                                {(o) => (
                                  <span class="role-badge">
                                    {o.name} · {roleLabel(o.role)}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                        </td>
                        <td>
                          <Show
                            when={user.mustChangePassword}
                            fallback={<span class="org-table__muted">{t('org.page.active')}</span>}
                          >
                            <span class="role-badge role-badge--warning">
                              {t('org.page.pendingPassword')}
                            </span>
                          </Show>
                        </td>
                        <td class="org-table__muted">{formatTimeAgo(user.createdAt)}</td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={t('org.users.instanceAdminOf', { email: user.email })}
                            checked={user.isInstanceAdmin}
                            // Revoking your own flag would lock you out of this page.
                            disabled={isSelf() || busyUser() === user.id}
                            title={isSelf() ? t('org.users.cannotRevokeSelf') : undefined}
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
                                {t('org.users.resetPassword')}
                              </button>
                            }
                          >
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              disabled={busyUser() === user.id}
                              onClick={() => void handleReset(user.id, user.email)}
                            >
                              {t('org.users.confirmReset')}
                            </button>
                            <button
                              type="button"
                              class="btn btn--outline btn--sm"
                              onClick={() => setConfirmReset(null)}
                            >
                              {t('common.cancel')}
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
