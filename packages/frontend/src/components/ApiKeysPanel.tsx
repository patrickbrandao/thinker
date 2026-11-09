import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Badge, Button, Field, Panel } from './ui.js';
import CopyButton from './CopyButton.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type CreatedApiKey,
} from '../services/api/api-keys.js';
import { formatDateTime } from '../services/formatters.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

const EXPIRY_OPTIONS: Array<number | null> = [null, 30, 90, 365];

/**
 * API keys of the active organization: one credential for the REST API, the
 * `thinker` CLI and MCP. Owners and admins create (never-expiring by default)
 * and revoke them; the full key is shown once, right after creation.
 */
export default function ApiKeysPanel({ orgId }: { orgId: string }) {
  const keys = useResource(async () => (await listApiKeys()).keys, [orgId]);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      setCreated(await createApiKey(name.trim(), expiry));
      setName('');
      await keys.reload();
    } catch {
      // toasted by fetchMutate
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeApiKey(id);
      toast.success(t('org.apiKeys.revoked'));
      setConfirmRevoke(null);
      await keys.reload();
    } catch {
      // toasted by fetchMutate
    }
  };

  return (
    <Panel title={t('org.apiKeys.title')} bodyClassName="flex flex-col gap-4">
      <p className="text-sm text-dim">{t('org.apiKeys.body')}</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
        <Field
          className="min-w-[220px] flex-1"
          label={t('org.apiKeys.name')}
          htmlFor="api-key-name"
        >
          <input
            id="api-key-name"
            className="field"
            type="text"
            maxLength={100}
            placeholder={t('org.apiKeys.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field className="w-[180px]" label={t('org.apiKeys.expiry')} htmlFor="api-key-expiry">
          <select
            id="api-key-expiry"
            className="field"
            value={expiry === null ? '' : String(expiry)}
            onChange={(e) => setExpiry(e.target.value ? Number(e.target.value) : null)}
          >
            {EXPIRY_OPTIONS.map((d) => (
              <option key={String(d)} value={d === null ? '' : String(d)}>
                {d === null ? t('org.apiKeys.never') : t('org.apiKeys.days', { days: String(d) })}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" busy={creating} disabled={creating || !name.trim()}>
          {t('org.apiKeys.create')}
        </Button>
      </form>

      {created ? (
        <div className="well flex flex-col gap-2" role="status">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <KeyRound className="size-[15px] text-accent" aria-hidden="true" />
            {t('org.apiKeys.createdTitle', { name: created.name })}
          </span>
          <span className="text-xs text-warn">{t('org.apiKeys.createdWarning')}</span>
          <div className="flex items-center gap-2 rounded-control border border-line bg-elev px-2.5 py-1.5">
            <code
              className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink"
              data-testid="created-api-key"
            >
              {created.key}
            </code>
            <CopyButton text={created.key} />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
              {t('org.apiKeys.saved')}
            </Button>
          </div>
        </div>
      ) : null}

      {keys.data && keys.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {keys.data.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-sm text-ink">
                  {k.name}
                  <Badge mono tone="outline">
                    {k.key_prefix}…
                  </Badge>
                  {k.kind === 'cli' ? <Badge tone="info">{t('org.apiKeys.cliLogin')}</Badge> : null}
                </span>
                <span className="text-xs text-dim">
                  {t('org.apiKeys.meta', {
                    created: formatDateTime(k.created_at),
                    by: k.created_by_email ?? '—',
                    used: k.last_used_at
                      ? formatDateTime(k.last_used_at)
                      : t('org.apiKeys.neverUsed'),
                    expires: k.expires_at ? formatDateTime(k.expires_at) : t('org.apiKeys.never'),
                  })}
                </span>
              </div>
              {confirmRevoke === k.id ? (
                <>
                  <Button variant="danger" size="sm" onClick={() => void handleRevoke(k.id)}>
                    {t('org.apiKeys.confirmRevoke')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(null)}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(k.id)}>
                  {t('org.apiKeys.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : keys.data ? (
        <p className="text-sm text-dim">{t('org.apiKeys.empty')}</p>
      ) : null}
    </Panel>
  );
}
