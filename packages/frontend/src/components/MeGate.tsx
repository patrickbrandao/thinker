import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { authClient } from '../services/auth-client.js';
import { createOrganization, setActiveOrganization } from '../services/api/organizations.js';
import { passwordChangeRequired, setActiveOrganizationId } from '../services/org-context.js';
import { loadMe, me } from '../services/session-store.js';
import { useSignal } from '../lib/signal.js';
import { t } from '../i18n/index.js';
import { Button, Field } from './ui.jsx';

type GateState = 'loading' | 'ready' | 'no-org' | 'error';

const SYNC_KEY = 'thinker.activeOrganizationSynced';

/**
 * Keeps the server-side saved organization in step with this browser's choice
 * once per tab session. The SSE stream can't send the organization header, so
 * the backend resolves it from that saved value.
 */
function syncSavedOrganization(orgId: string): void {
  try {
    if (sessionStorage.getItem(SYNC_KEY) === orgId) return;
    sessionStorage.setItem(SYNC_KEY, orgId);
  } catch {
    // Storage blocked: sync every load instead.
  }
  void setActiveOrganization(orgId).catch(() => {});
}

/**
 * Loads `/me` before the dashboard renders, routes to the forced password
 * change when required (on load or when any API call is refused with
 * `password_change_required`), and handles a user with no organization.
 */
export default function MeGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const mustChange = useSignal(passwordChangeRequired);
  const profile = useSignal(me);
  const [state, setState] = useState<GateState>('loading');
  const [error, setError] = useState('');
  const [orgName, setOrgName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const m = await loadMe();
      if (m.mustChangePassword) return; // the effect below navigates
      if (!m.organization) {
        setState('no-org');
        return;
      }
      syncSavedOrganization(m.organization.id);
      setState('ready');
    } catch (err) {
      if (passwordChangeRequired()) return;
      setError(err instanceof Error ? err.message : t('org.gate.loadFailed'));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mustChange) navigate('/change-password', { replace: true });
  }, [mustChange, navigate]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = orgName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const org = await createOrganization(name);
      setActiveOrganizationId(org.id);
      await setActiveOrganization(org.id).catch(() => {});
      await load();
    } catch {
      // fetchMutate already toasted the backend message
    } finally {
      setCreating(false);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    window.location.replace('/login');
  };

  if (state === 'ready') return <>{children}</>;
  if (state === 'loading')
    return (
      <div className="gate" aria-busy="true">
        <span className="spinner" />
        <p className="text-sm text-muted">{t('common.loading')}</p>
      </div>
    );
  if (state === 'error')
    return (
      <div className="gate" role="alert">
        <h2>{t('org.gate.couldNotLoad')}</h2>
        <p className="text-sm text-muted">{error}</p>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          {t('common.tryAgain')}
        </Button>
      </div>
    );
  return (
    <div className="gate">
      <h2>{t('org.gate.noOrg')}</h2>
      {profile?.isInstanceAdmin ? (
        <>
          <p className="max-w-sm text-sm text-muted">{t('org.gate.noOrgAdmin')}</p>
          <form className="flex w-full max-w-xs flex-col gap-3 text-left" onSubmit={handleCreate}>
            <Field label={t('org.gate.orgName')} htmlFor="gate-org-name">
              <input
                id="gate-org-name"
                className="field"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" busy={creating}>
              {t('org.gate.createOrg')}
            </Button>
          </form>
        </>
      ) : (
        <p className="max-w-sm text-sm text-muted">{t('org.gate.notMember')}</p>
      )}
      <Button variant="quiet" size="sm" onClick={() => void signOut()}>
        {t('nav.logOut')}
      </Button>
    </div>
  );
}
