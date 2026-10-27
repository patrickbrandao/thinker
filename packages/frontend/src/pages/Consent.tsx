import { useSearchParams } from '@solidjs/router';
import { Title } from '@solidjs/meta';
import { Show, createEffect, createSignal, type Component } from 'solid-js';
import { THINKER_LOGO_URL, THINKER_LOGO_DARK_URL } from '../services/thinker-links.js';
import { t, tMaybe } from '../i18n/index.js';

interface ClientSummary {
  client_id: string;
  client_name?: string;
  client_uri?: string;
}

const SCOPE_KEYS: Record<string, string> = {
  'mcp:read': 'read',
  'mcp:write': 'write',
  offline_access: 'offline',
};

const scopeCopy = (scope: string): string => {
  const key = SCOPE_KEYS[scope];
  return (key && tMaybe(`auth.consent.scopes.${key}`)) || scope;
};

/**
 * The OAuth consent screen for the remote MCP server.
 *
 * Better Auth's MCP plugin sends an authenticated user here with the standard
 * authorization query. The explicit click is a security boundary — a drive-by
 * link must never silently grant an MCP client access to a workspace.
 */
const Consent: Component = () => {
  const [params] = useSearchParams();
  const [client, setClient] = createSignal<ClientSummary | null>(null);
  const [loadError, setLoadError] = createSignal('');
  const [busy, setBusy] = createSignal<'approve' | 'deny' | null>(null);
  const [submitError, setSubmitError] = createSignal('');

  const clientId = () => String(params.client_id ?? '');
  const scopes = () =>
    String(params.scope ?? '')
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);

  /**
   * Keep only the OAuth parameters covered by Better Auth's signed query. The
   * server verifies `sig`; forwarding unsigned extras would fail that check.
   */
  const signedOAuthQuery = (): string | undefined => {
    const search = new URLSearchParams(window.location.search);
    if (!search.has('sig')) return undefined;
    const signedNames = search.getAll('ba_param');
    if (signedNames.length === 0) return undefined;
    const allowed = new Set(signedNames);
    const signed = new URLSearchParams();
    for (const [key, value] of search) {
      if (key === 'sig' || key === 'ba_param' || allowed.has(key)) signed.append(key, value);
    }
    return signed.toString();
  };

  createEffect(() => {
    if (!clientId()) {
      setLoadError(t('auth.consent.noClientId'));
      return;
    }
    void fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId())}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? (r.json() as Promise<ClientSummary>) : Promise.reject()))
      .then(setClient)
      .catch(() => setLoadError(t('auth.consent.loadFailed')));
  });

  const decide = async (accept: boolean): Promise<void> => {
    const oauthQuery = signedOAuthQuery();
    if (!oauthQuery) {
      setSubmitError(t('auth.consent.badSignature'));
      return;
    }
    setBusy(accept ? 'approve' : 'deny');
    setSubmitError('');
    try {
      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
        error_description?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.message || body?.error_description || body?.error || t('auth.consent.failed'),
        );
      }
      if (typeof body?.url === 'string') {
        window.location.assign(body.url);
      } else {
        setSubmitError(t('auth.consent.noRedirect'));
        setBusy(null);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  return (
    <div class="auth-layout">
      <Title>{t('common.pageTitle', { page: t('auth.consent.pageTitle') })}</Title>
      <div class="auth-card" style="text-align: center;">
        <div class="auth-logo">
          <img src={THINKER_LOGO_URL} alt="Thinker" class="auth-logo__img auth-logo__img--light" />
          <img src={THINKER_LOGO_DARK_URL} alt="" class="auth-logo__img auth-logo__img--dark" />
        </div>
        <Show
          when={!loadError()}
          fallback={
            <div class="auth-header">
              <h1 class="auth-header__title">{t('auth.consent.invalidTitle')}</h1>
              <p class="auth-header__subtitle">{loadError()}</p>
            </div>
          }
        >
          <div class="auth-header">
            <h1 class="auth-header__title">{t('auth.consent.title')}</h1>
            <p class="auth-header__subtitle">
              <strong>{client()?.client_name || clientId()}</strong>{' '}
              {t('auth.consent.wantsToConnect')}
            </p>
            <Show when={client()?.client_uri}>
              <p class="auth-header__subtitle">{client()?.client_uri}</p>
            </Show>
          </div>
          <ul style="text-align: left; margin: 0 auto 1rem; max-width: 320px;">
            {scopes().map((scope) => (
              <li>{scopeCopy(scope)}</li>
            ))}
          </ul>
          <Show when={submitError()}>
            <div class="auth-form__error" role="alert">
              {submitError()}
            </div>
          </Show>
          <div class="auth-form" style="display: flex; gap: 0.75rem;">
            <button
              class="auth-form__submit"
              type="button"
              disabled={busy() !== null}
              onClick={() => void decide(true)}
            >
              {busy() === 'approve' ? t('auth.consent.allowing') : t('auth.consent.allow')}
            </button>
            <button
              class="auth-form__submit auth-form__submit--secondary"
              type="button"
              disabled={busy() !== null}
              onClick={() => void decide(false)}
            >
              {busy() === 'deny' ? t('auth.consent.denying') : t('auth.consent.deny')}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default Consent;
