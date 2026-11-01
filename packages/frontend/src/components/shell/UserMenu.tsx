import { useCallback, useState } from 'react';
import {
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Network,
  Plus,
  Settings,
  ShieldCheck,
  Terminal,
  Unplug,
  Users,
  Zap,
} from 'lucide-react';
import { authClient } from '../../services/auth-client.js';
import { createOrganization, listOrganizations } from '../../services/api/organizations.js';
import { checkMcpEnabled } from '../../services/setup-status.js';
import { roleLabel } from '../../services/permissions.js';
import { me, roleCan, switchOrganization } from '../../services/session-store.js';
import { useSignal } from '../../lib/signal.js';
import { useResource } from '../../lib/use-resource.js';
import { t } from '../../i18n/index.js';
import {
  Avatar,
  Button,
  Field,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  Modal,
} from '../ui.jsx';

export async function signOut(): Promise<void> {
  await authClient.signOut();
  window.location.replace('/login');
}

/**
 * Bottom-left account menu: who is signed in, the active organization (and
 * switching to another one), account preferences, organization members,
 * instance administration and integrations, and sign out.
 */
export default function UserMenu() {
  const session = authClient.useSession();
  const profile = useSignal(me);
  const [createOpen, setCreateOpen] = useState(false);
  const orgs = useResource(async () => (await listOrganizations()).organizations, []);
  const mcp = useResource(checkMcpEnabled, []);

  const user = session.data?.user;
  const name = user?.name || t('nav.userFallback');
  const org = profile?.organization ?? null;
  const isInstanceAdmin = profile?.isInstanceAdmin === true;

  const organizations = (() => {
    const loaded = orgs.data ?? [];
    if (org && !loaded.some((o) => o.id === org.id)) return [org, ...loaded];
    return loaded;
  })();

  const closeCreate = useCallback(() => setCreateOpen(false), []);

  return (
    <>
      <Menu
        up
        className="w-[272px]"
        label={t('nav.userMenu')}
        trigger={(props) => (
          <button type="button" className="user-trigger" title={name} {...props}>
            <Avatar name={name} />
            <span className="user-text">
              <span className="user-name">{name}</span>
              <span className="user-org">{org?.name ?? user?.email}</span>
            </span>
            <ChevronsUpDown />
          </button>
        )}
      >
        <div className="menu-card">
          <div className="text-[13px] font-semibold text-ink truncate">{name}</div>
          {user?.email ? <div className="text-xs text-muted truncate">{user.email}</div> : null}
        </div>
        <MenuSeparator />
        <MenuHeading>{t('shell.user.organization')}</MenuHeading>
        {org ? (
          <div className="menu-card">
            <div className="flex items-center gap-2 text-[13px] text-ink">
              <Building2 className="size-[15px] text-muted" />
              <span className="truncate font-medium">{org.name}</span>
            </div>
            <div className="mt-0.5 pl-[23px] text-xs text-muted">
              {t('shell.user.role', { role: roleLabel(org.role) })}
              {isInstanceAdmin ? ` · ${t('shell.user.instanceAdmin')}` : ''}
            </div>
          </div>
        ) : null}
        <MenuItem icon={<Users />} to="/organization">
          {roleCan.manageMembers()
            ? t('shell.user.manageOrganization')
            : t('shell.user.viewOrganization')}
        </MenuItem>
        <MenuItem icon={<Zap />} to="/triggers">
          {t('nav.triggers')}
        </MenuItem>
        {roleCan.manageProviders() ? (
          <MenuItem icon={<Network />} to="/proxy-servers">
            {t('nav.proxyServers')}
          </MenuItem>
        ) : null}
        {organizations.length > 1 ? (
          <>
            <MenuHeading>{t('shell.user.switchOrganization')}</MenuHeading>
            {organizations.map((o) => (
              <MenuItem
                key={o.id}
                icon={o.id === org?.id ? <Check /> : <Building2 />}
                active={o.id === org?.id}
                meta={roleLabel(o.role)}
                onSelect={() => {
                  if (o.id !== org?.id) void switchOrganization(o.id);
                }}
              >
                {o.name}
              </MenuItem>
            ))}
          </>
        ) : null}
        {isInstanceAdmin ? (
          <MenuItem icon={<Plus />} onSelect={() => setCreateOpen(true)}>
            {t('shell.user.newOrganization')}
          </MenuItem>
        ) : null}
        {isInstanceAdmin ? (
          <>
            <MenuSeparator />
            <MenuHeading>{t('shell.user.administration')}</MenuHeading>
            <MenuItem icon={<ShieldCheck />} to="/admin/users">
              {t('nav.users')}
            </MenuItem>
          </>
        ) : null}
        <MenuSeparator />
        <MenuHeading>{t('nav.sectionIntegrations')}</MenuHeading>
        {mcp.data ? (
          <MenuItem icon={<Unplug />} to="/integrations/mcp">
            {t('nav.mcpServer')}
          </MenuItem>
        ) : null}
        <MenuItem icon={<Terminal />} to="/integrations/cli">
          CLI
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Settings />} to="/account">
          {t('nav.accountPreferences')}
        </MenuItem>
        <MenuItem icon={<LogOut />} danger onSelect={() => void signOut()}>
          {t('nav.logOut')}
        </MenuItem>
      </Menu>
      <NewOrganizationModal open={createOpen} onClose={closeCreate} />
    </>
  );
}

function NewOrganizationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const created = await createOrganization(trimmed);
      onClose();
      setName('');
      await switchOrganization(created.id);
    } catch {
      // fetchMutate already showed the backend message.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('shell.user.newOrganization')}>
      <form onSubmit={submit}>
        <Field label={t('org.gate.orgName')} htmlFor="new-org-name">
          <input
            id="new-org-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <div className="actions">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" busy={busy}>
            {t('org.gate.createOrg')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
