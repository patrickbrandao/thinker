import { useNavigate } from '@solidjs/router';
import { Match, Switch, createEffect, createSignal, onMount, type ParentComponent } from 'solid-js';
import { authClient } from '../services/auth-client.js';
import { createOrganization, setActiveOrganization } from '../services/api/organizations.js';
import { passwordChangeRequired, setActiveOrganizationId } from '../services/org-context.js';
import { loadMe, me } from '../services/session-store.js';
import '../styles/organization.css';
import { t } from '../i18n/index.js';

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
const MeGate: ParentComponent = (props) => {
  const navigate = useNavigate();
  const [state, setState] = createSignal<GateState>('loading');
  const [error, setError] = createSignal('');
  const [orgName, setOrgName] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const load = async () => {
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
  };

  onMount(() => void load());

  createEffect(() => {
    if (passwordChangeRequired()) navigate('/change-password', { replace: true });
  });

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const name = orgName().trim();
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

  return (
    <Switch>
      <Match when={state() === 'ready'}>{props.children}</Match>
      <Match when={state() === 'loading'}>
        <div class="org-gate" aria-busy="true">
          <p class="org-gate__text">{t('common.loading')}</p>
        </div>
      </Match>
      <Match when={state() === 'error'}>
        <div class="org-gate" role="alert">
          <span class="org-gate__title">{t('org.gate.couldNotLoad')}</span>
          <p class="org-gate__text">{error()}</p>
          <div>
            <button type="button" class="btn btn--outline btn--sm" onClick={() => void load()}>
              {t('common.tryAgain')}
            </button>
          </div>
        </div>
      </Match>
      <Match when={state() === 'no-org'}>
        <div class="org-gate">
          <span class="org-gate__title">{t('org.gate.noOrg')}</span>
          {me()?.isInstanceAdmin ? (
            <>
              <p class="org-gate__text">{t('org.gate.noOrgAdmin')}</p>
              <form class="org-form" style="padding: 0;" onSubmit={handleCreate}>
                <label class="org-form__field">
                  {t('org.gate.orgName')}
                  <input
                    class="auth-form__input"
                    type="text"
                    value={orgName()}
                    onInput={(e) => setOrgName(e.currentTarget.value)}
                    required
                  />
                </label>
                <button class="btn btn--primary btn--sm" type="submit" disabled={creating()}>
                  {t('org.gate.createOrg')}
                </button>
              </form>
            </>
          ) : (
            <p class="org-gate__text">{t('org.gate.notMember')}</p>
          )}
          <div>
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => void signOut()}>
              {t('nav.logOut')}
            </button>
          </div>
        </div>
      </Match>
    </Switch>
  );
};

export default MeGate;
