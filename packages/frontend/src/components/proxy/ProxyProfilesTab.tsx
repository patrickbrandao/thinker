import { useState } from 'react';
import { Pencil, Plus, Route, Trash2, Waypoints } from 'lucide-react';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import {
  createProxyProfile,
  deleteProxyProfile,
  listProxies,
  listProxyProfiles,
  updateProxyProfile,
  type ProxyProfile,
} from '../../services/api/proxies.js';
import { toast } from '../../services/toast-store.js';
import ErrorState from '../ErrorState.js';
import { Badge, Button, EmptyState, Field, IconButton, Modal } from '../ui.js';
import { chainText } from './OutboundProxyPanel.js';
import ProxyChainEditor from './ProxyChainEditor.js';
import { DIRECT, validateChain } from './proxy-chain.js';
import { sourceTypeLabel } from './ProxyParts.js';

const chainIds = (profile: ProxyProfile) =>
  profile.chain.map((item) => (item.kind === 'direct' ? DIRECT : (item.proxy_id ?? '')));

/** Outbound profiles: named, ordered chains of proxy servers and Direct. */
export default function ProxyProfilesTab() {
  const res = useResource(async () => (await listProxyProfiles())?.profiles ?? [], []);
  const proxies = useResource(async () => (await listProxies())?.proxies ?? [], []);
  const [editing, setEditing] = useState<ProxyProfile | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProxyProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const list = res.data ?? [];

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteProxyProfile(deleting.id, deleting.used_by.length > 0);
      toast.success(t('proxies.profiles.deleted'));
      setDeleting(null);
      await res.reload();
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 max-w-3xl text-sm text-muted">{t('proxies.profiles.subtitle')}</p>
        <Button size="sm" className="shrink-0" onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('proxies.profiles.create')}
        </Button>
      </div>

      {res.error ? (
        <ErrorState error={res.error} onRetry={() => void res.reload()} />
      ) : !res.loading && list.length === 0 ? (
        <EmptyState
          icon={<Route aria-hidden="true" />}
          title={t('proxies.profiles.emptyTitle')}
          description={t('proxies.profiles.emptyBody')}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('proxies.list.name')}</th>
                <th>{t('proxies.profiles.chain')}</th>
                <th className="num">{t('proxies.profiles.usedBy')}</th>
                <th aria-label={t('proxies.profiles.actions')} />
              </tr>
            </thead>
            <tbody>
              {list.map((profile) => (
                <tr key={profile.id}>
                  <td className="row-title">
                    <span className="inline-flex items-center gap-2">
                      <Waypoints aria-hidden="true" className="size-4 shrink-0 text-muted" />
                      {profile.name}
                    </span>
                  </td>
                  <td className="text-sm text-dim">
                    {profile.chain.length ? chainText(profile.chain) : '—'}
                    {profile.chain.some((i) => i.kind === 'proxy' && !i.enabled) ? (
                      <>
                        {' '}
                        <Badge tone="warn">{t('proxies.binding.disabledProxy')}</Badge>
                      </>
                    ) : null}
                  </td>
                  <td className="num" title={profile.used_by.map((u) => u.label).join('\n')}>
                    {profile.used_by.length}
                  </td>
                  <td className="text-right">
                    <IconButton
                      label={t('proxies.profiles.edit', { name: profile.name })}
                      onClick={() => setEditing(profile)}
                    >
                      <Pencil aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={t('proxies.profiles.delete', { name: profile.name })}
                      className="hover:text-danger"
                      onClick={() => setDeleting(profile)}
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ProfileModal
          profile={editing === 'new' ? null : editing}
          proxies={proxies.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void res.reload();
          }}
        />
      ) : null}

      <Modal
        open={!!deleting}
        title={t('proxies.profiles.deleteTitle', { name: deleting?.name ?? '' })}
        onClose={() => setDeleting(null)}
      >
        {deleting && deleting.used_by.length > 0 ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0 text-dim">
              {t('proxies.profiles.deleteInUse', { count: deleting.used_by.length })}
            </p>
            <ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-auto p-0">
              {deleting.used_by.map((u) => (
                <li key={`${u.target_type}:${u.target_id}`} className="flex items-center gap-2">
                  <Badge>{sourceTypeLabel(u.target_type)}</Badge>
                  <span className="min-w-0 truncate text-ink">{u.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-dim">
            {t('proxies.profiles.deleteConfirm', { name: deleting?.name ?? '' })}
          </p>
        )}
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" busy={busy} onClick={() => void remove()}>
            {t('proxies.delete.submit')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ProfileModal({
  profile,
  proxies,
  onClose,
  onSaved,
}: {
  profile: ProxyProfile | null;
  proxies: Parameters<typeof ProxyChainEditor>[0]['proxies'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? '');
  const [chain, setChain] = useState<string[]>(profile ? chainIds(profile) : []);
  const [saving, setSaving] = useState(false);
  const rule = chain.length === 0 ? 'emptyProfile' : validateChain(chain);
  const error = rule ? t(`proxies.binding.errors.${rule}`) : null;

  const save = async () => {
    setSaving(true);
    try {
      const data = { name: name.trim(), chain };
      if (profile) await updateProxyProfile(profile.id, data);
      else await createProxyProfile(data);
      toast.success(t('proxies.profiles.saved'));
      onSaved();
    } catch {
      // toasted
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      wide
      title={profile ? t('proxies.profiles.editTitle') : t('proxies.profiles.createTitle')}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('proxies.list.name')} htmlFor="proxy-profile-name">
          <input
            id="proxy-profile-name"
            className="field"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Field>
        <div>
          <span className="label">{t('proxies.profiles.chain')}</span>
          <p className="hint mt-0">{t('proxies.profiles.chainHint')}</p>
          <ProxyChainEditor value={chain} onChange={setChain} proxies={proxies} />
        </div>
        {error && chain.length > 0 ? (
          <p className="hint m-0" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
      </div>
      <div className="actions">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          busy={saving}
          disabled={!name.trim() || !!error}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
