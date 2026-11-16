import { useState, type FormEvent } from 'react';
import { LayoutGrid, Plus, Rows3, UserRound } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import TemporaryPasswordBox from '../components/TemporaryPasswordBox.js';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FloatingWindow,
  Skel,
  Switch,
} from '../components/ui.js';
import {
  createAdminUser,
  listAdminUsers,
  listOrganizations,
  resetUserPassword,
  setInstanceAdmin,
  type AdminUser,
  type OrganizationRef,
  type OrgRole,
} from '../services/api/organizations.js';
import { formatTimeAgo } from '../services/formatters.js';
import { ALL_ROLES, roleLabel } from '../services/permissions.js';
import { me } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

type UsersView = 'grid' | 'table';
const VIEW_STORAGE_KEY = 'thinker_users_view';

function readStoredView(): UsersView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Which user the floating window shows: a new account, or an existing one by id. */
type WindowTarget = { mode: 'create' } | { mode: 'edit'; userId: string };

/**
 * Instance-admin account management: every user with their organizations.
 * Creating and editing an account (instance-admin flag, password reset)
 * happens in a floating window. Temporary passwords are shown once and never
 * stored.
 */
export default function AdminUsers() {
  const profile = useSignal(me);
  const isAdmin = profile?.isInstanceAdmin === true;
  const users = useResource(async () => (await listAdminUsers()).users, [], { enabled: isAdmin });
  const orgs = useResource(async () => (await listOrganizations()).organizations, [], {
    enabled: isAdmin,
  });

  const [view, setView] = useState<UsersView>(readStoredView);
  const switchView = (next: UsersView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  const [target, setTarget] = useState<WindowTarget | null>(null);
  const openEdit = (userId: string) => setTarget({ mode: 'edit', userId });

  const list = users.data ?? [];
  const firstLoad = users.loading && !users.data && !users.error;
  const editing =
    target?.mode === 'edit' ? (list.find((u) => u.id === target.userId) ?? null) : null;

  const nameOf = (user: AdminUser) => (
    <>
      {user.name || user.email}
      {user.id === profile?.userId ? (
        <span className="font-normal text-muted"> {t('org.page.you')}</span>
      ) : null}
    </>
  );
  const orgBadges = (user: AdminUser) =>
    user.organizations.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {user.organizations.map((o) => (
          <Badge key={o.id}>
            {o.name} · {roleLabel(o.role)}
          </Badge>
        ))}
      </div>
    ) : (
      <span className="text-muted">{t('common.none')}</span>
    );
  const status = (user: AdminUser) =>
    user.mustChangePassword ? (
      <Badge tone="warn">{t('org.page.pendingPassword')}</Badge>
    ) : (
      <span className="text-muted">{t('org.page.active')}</span>
    );

  const viewToggle = (
    <div className="segmented" role="group" aria-label={t('org.users.layout')}>
      <button
        type="button"
        aria-pressed={view === 'grid'}
        aria-label={t('org.users.gridView')}
        title={t('org.users.gridView')}
        onClick={() => switchView('grid')}
      >
        <LayoutGrid className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-pressed={view === 'table'}
        aria-label={t('org.users.tableView')}
        title={t('org.users.tableView')}
        onClick={() => switchView('table')}
      >
        <Rows3 className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );

  const tableView = (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('org.users.user')}</th>
            <th>{t('org.users.organizations')}</th>
            <th>{t('common.status')}</th>
            <th>{t('org.users.created')}</th>
            <th aria-label={t('common.actions')} />
          </tr>
        </thead>
        <tbody>
          {list.map((user) => (
            <tr key={user.id}>
              <td>
                <button
                  type="button"
                  className="row-title text-left hover:underline"
                  onClick={() => openEdit(user.id)}
                >
                  {nameOf(user)}
                </button>
                <div className="row-sub">{user.email}</div>
              </td>
              <td>{orgBadges(user)}</td>
              <td>{status(user)}</td>
              <td className="text-muted">{formatTimeAgo(user.createdAt)}</td>
              <td>
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('org.users.editOf', { email: user.email })}
                    onClick={() => openEdit(user.id)}
                  >
                    {t('common.edit')}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const gridView = (
    <div className="card-grid">
      {list.map((user) => (
        <button
          key={user.id}
          type="button"
          aria-label={t('org.users.editOf', { email: user.email })}
          onClick={() => openEdit(user.id)}
          className="card flex flex-col gap-3 text-left transition-colors hover:border-accent hover:bg-s2 [.dark_&]:hover:bg-sunken"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold text-ink">{nameOf(user)}</span>
            <span className="truncate text-sm text-muted">{user.email}</span>
          </div>
          {orgBadges(user)}
          <div className="flex items-center justify-between gap-2 text-xs">
            {status(user)}
            <span className="text-muted">{formatTimeAgo(user.createdAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );

  const skeleton = (
    <div className="card-grid">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card flex flex-col gap-3">
          <Skel width="60%" height={18} />
          <Skel width="40%" height={14} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('org.users.title') })}</title>
      <meta name="description" content={t('org.users.metaDescription')} />
      {!isAdmin ? (
        <ErrorState title={t('org.users.notAvailable')} message={t('org.users.adminsOnly')} />
      ) : (
        <>
          <div className="page-head justify-end">
            <div className="page-actions">
              {viewToggle}
              <Button size="sm" onClick={() => setTarget({ mode: 'create' })}>
                <Plus aria-hidden="true" />
                {t('org.users.create')}
              </Button>
            </div>
          </div>

          {firstLoad ? (
            skeleton
          ) : users.error ? (
            <ErrorState error={users.error} onRetry={() => void users.reload()} />
          ) : list.length === 0 ? (
            <div className="panel">
              <EmptyState title={t('org.users.empty')} />
            </div>
          ) : view === 'grid' ? (
            gridView
          ) : (
            tableView
          )}

          {target?.mode === 'create' ? (
            <CreateUserWindow
              orgs={orgs.data ?? []}
              onClose={() => setTarget(null)}
              onCreated={() => void users.reload()}
            />
          ) : null}
          {editing ? (
            <EditUserWindow
              key={editing.id}
              user={editing}
              isSelf={editing.id === profile?.userId}
              onClose={() => setTarget(null)}
              onChanged={() => void users.reload()}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function CreateUserWindow({
  orgs,
  onClose,
  onCreated,
}: {
  orgs: OrganizationRef[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await createAdminUser({
        email: email.trim(),
        name: name.trim(),
        ...(makeAdmin ? { isInstanceAdmin: true } : {}),
        // A superuser already acts as owner everywhere; the organization is only
        // where they land, so they join it as its owner.
        ...(orgId ? { organizationId: orgId, role: makeAdmin ? 'owner' : role } : {}),
      });
      setCreated({ email: res.user.email, password: res.temporaryPassword });
      onCreated();
    } catch {
      // toasted by fetchMutate
    } finally {
      setCreating(false);
    }
  };

  return (
    <FloatingWindow
      open
      title={t('org.users.create')}
      icon={<UserRound aria-hidden="true" className="size-4" />}
      onClose={onClose}
      footer={
        created ? (
          <Button size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit" form="admin-user-create" busy={creating}>
              {t('org.users.create')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <TemporaryPasswordBox
          email={created.email}
          password={created.password}
          onDismiss={onClose}
        />
      ) : (
        <form
          id="admin-user-create"
          className="flex flex-col gap-3"
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
              autoFocus
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
          <label className="check items-start">
            <input
              type="checkbox"
              checked={makeAdmin}
              onChange={(e) => setMakeAdmin(e.target.checked)}
            />
            <span className="flex flex-col">
              {t('org.users.instanceAdmin')}
              <span className="text-xs text-muted">{t('org.users.instanceAdminHint')}</span>
            </span>
          </label>
          <div className={makeAdmin ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
            <Field
              label={makeAdmin ? t('org.users.initialOrgOptional') : t('org.users.orgOptional')}
              htmlFor="admin-user-org"
            >
              <select
                id="admin-user-org"
                className="field"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
              >
                <option value="">{t('common.none')}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            {makeAdmin ? null : (
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
            )}
          </div>
        </form>
      )}
    </FloatingWindow>
  );
}

function EditUserWindow({
  user,
  isSelf,
  onClose,
  onChanged,
}: {
  user: AdminUser;
  isSelf: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const handleToggleAdmin = async (next: boolean) => {
    setBusy(true);
    try {
      await setInstanceAdmin(user.id, next);
      toast.success(next ? t('org.users.adminGranted') : t('org.users.adminRevoked'));
    } catch {
      // toasted by fetchMutate
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      const res = await resetUserPassword(user.id);
      setConfirmReset(false);
      setTempPassword(res.temporaryPassword);
      onChanged();
    } catch {
      // toasted by fetchMutate
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingWindow
      open
      title={user.name || user.email}
      icon={<UserRound aria-hidden="true" className="size-4" />}
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t('common.email')}</dt>
          <dd className="min-w-0 truncate">{user.email}</dd>
          <dt className="text-muted">{t('org.users.organizations')}</dt>
          <dd className="flex flex-wrap gap-1">
            {user.organizations.length > 0 ? (
              user.organizations.map((o) => (
                <Badge key={o.id}>
                  {o.name} · {roleLabel(o.role)}
                </Badge>
              ))
            ) : (
              <span className="text-muted">{t('common.none')}</span>
            )}
          </dd>
          <dt className="text-muted">{t('common.status')}</dt>
          <dd>
            {user.mustChangePassword ? (
              <Badge tone="warn">{t('org.page.pendingPassword')}</Badge>
            ) : (
              t('org.page.active')
            )}
          </dd>
          <dt className="text-muted">{t('org.users.created')}</dt>
          <dd>{formatTimeAgo(user.createdAt)}</dd>
        </dl>

        <div
          className="flex items-center justify-between gap-3 border-t border-line pt-4"
          title={isSelf ? t('org.users.cannotRevokeSelf') : undefined}
        >
          <span className="flex flex-col text-sm">
            {t('org.users.instanceAdmin')}
            <span className="text-xs text-muted">{t('org.users.instanceAdminHint')}</span>
          </span>
          <Switch
            label={t('org.users.instanceAdminOf', { email: user.email })}
            checked={user.isInstanceAdmin}
            // Revoking your own flag would lock you out of this page.
            disabled={isSelf || busy}
            onChange={(next) => void handleToggleAdmin(next)}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('org.users.password')}</span>
            {confirmReset ? (
              <div className="flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="danger" size="sm" busy={busy} onClick={() => void handleReset()}>
                  {t('org.users.confirmReset')}
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                {t('org.users.resetPassword')}
              </Button>
            )}
          </div>
          {tempPassword ? (
            <TemporaryPasswordBox
              email={user.email}
              password={tempPassword}
              onDismiss={() => setTempPassword(null)}
            />
          ) : null}
        </div>
      </div>
    </FloatingWindow>
  );
}
