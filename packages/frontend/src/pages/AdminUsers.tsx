import { useState, type FormEvent } from 'react';
import ErrorState from '../components/ErrorState.js';
import TemporaryPasswordBox from '../components/TemporaryPasswordBox.js';
import { Badge, Button, Field, Panel, Switch } from '../components/ui.js';
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
import { me } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/**
 * Instance-admin account management: every user with their organizations,
 * account creation, password reset and the instance-admin flag. Temporary
 * passwords are shown once and never stored.
 */
export default function AdminUsers() {
  const profile = useSignal(me);
  const isAdmin = profile?.isInstanceAdmin === true;
  const users = useResource(async () => (await listAdminUsers()).users, [], { enabled: isAdmin });
  const orgs = useResource(async () => (await listOrganizations()).organizations, [], {
    enabled: isAdmin,
  });

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await createAdminUser({
        email: email.trim(),
        name: name.trim(),
        ...(makeAdmin ? { isInstanceAdmin: true } : {}),
        ...(orgId ? { organizationId: orgId, role } : {}),
      });
      setTempPassword({ email: res.user.email, password: res.temporaryPassword });
      setEmail('');
      setName('');
      setMakeAdmin(false);
      setOrgId('');
      setRole('member');
      await users.reload();
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
      await users.reload();
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
      await users.reload();
    }
  };

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('org.users.title') })}</title>
      <meta name="description" content={t('org.users.metaDescription')} />
      {!isAdmin ? (
        <ErrorState title={t('org.users.notAvailable')} message={t('org.users.adminsOnly')} />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <Panel title={t('org.users.create')} bodyClassName="flex flex-col gap-4">
              <form
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_140px]"
                onSubmit={handleCreate}
                aria-label={t('org.users.create')}
              >
                <Field label={t('common.email')} htmlFor="admin-user-email">
                  <input
                    id="admin-user-email"
                    className="field"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('common.name')} htmlFor="admin-user-name">
                  <input
                    id="admin-user-name"
                    className="field"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('org.users.orgOptional')} htmlFor="admin-user-org">
                  <select
                    id="admin-user-org"
                    className="field"
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                  >
                    <option value="">{t('common.none')}</option>
                    {(orgs.data ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('common.role')} htmlFor="admin-user-role">
                  <select
                    id="admin-user-role"
                    className="field"
                    value={role}
                    disabled={!orgId}
                    onChange={(e) => setRole(e.target.value as OrgRole)}
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={makeAdmin}
                      onChange={(e) => setMakeAdmin(e.target.checked)}
                    />
                    {t('org.users.instanceAdmin')}
                  </label>
                  <Button type="submit" busy={creating}>
                    {t('org.users.create')}
                  </Button>
                </div>
              </form>
              {tempPassword ? (
                <TemporaryPasswordBox
                  email={tempPassword.email}
                  password={tempPassword.password}
                  onDismiss={() => setTempPassword(null)}
                />
              ) : null}
            </Panel>

            <Panel title={t('org.users.all')} bodyClassName="p-0">
              {users.error ? (
                <ErrorState error={users.error} onRetry={() => void users.reload()} />
              ) : (
                <div className="table-wrap rounded-none border-0">
                  <table className="data">
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
                      {users.loading && !users.data ? (
                        <tr>
                          <td colSpan={6} className="text-muted">
                            {t('org.users.loading')}
                          </td>
                        </tr>
                      ) : null}
                      {(users.data ?? []).map((user) => {
                        const isSelf = user.id === profile?.userId;
                        return (
                          <tr key={user.id}>
                            <td>
                              <div className="row-title">
                                {user.name || user.email}
                                {isSelf ? (
                                  <span className="font-normal text-muted">
                                    {' '}
                                    {t('org.page.you')}
                                  </span>
                                ) : null}
                              </div>
                              <div className="row-sub">{user.email}</div>
                            </td>
                            <td>
                              {user.organizations.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {user.organizations.map((o) => (
                                    <Badge key={o.id}>
                                      {o.name} · {roleLabel(o.role)}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted">{t('common.none')}</span>
                              )}
                            </td>
                            <td>
                              {user.mustChangePassword ? (
                                <Badge tone="warn">{t('org.page.pendingPassword')}</Badge>
                              ) : (
                                <span className="text-muted">{t('org.page.active')}</span>
                              )}
                            </td>
                            <td className="text-muted">{formatTimeAgo(user.createdAt)}</td>
                            <td>
                              <span
                                title={isSelf ? t('org.users.cannotRevokeSelf') : undefined}
                                className="inline-flex"
                              >
                                <Switch
                                  label={t('org.users.instanceAdminOf', { email: user.email })}
                                  checked={user.isInstanceAdmin}
                                  // Revoking your own flag would lock you out of this page.
                                  disabled={isSelf || busyUser === user.id}
                                  onChange={(next) => void handleToggleAdmin(user.id, next)}
                                />
                              </span>
                            </td>
                            <td>
                              <div className="row-actions gap-1.5">
                                {confirmReset === user.id ? (
                                  <>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      disabled={busyUser === user.id}
                                      onClick={() => void handleReset(user.id, user.email)}
                                    >
                                      {t('org.users.confirmReset')}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setConfirmReset(null)}
                                    >
                                      {t('common.cancel')}
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmReset(user.id)}
                                  >
                                    {t('org.users.resetPassword')}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
