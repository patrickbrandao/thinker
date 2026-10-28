import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import AuthLayout from '../layouts/AuthLayout.jsx';
import { AuthHeader } from '../components/auth-ui.jsx';
import { Button } from '../components/ui.jsx';
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
 * Keep only the OAuth parameters covered by Better Auth's signed query. The
 * server verifies `sig`; forwarding unsigned extras would fail that check.
 */
function signedOAuthQuery(): string | undefined {
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
}

/**
 * The OAuth consent screen for the remote MCP server.
 *
 * Better Auth's MCP plugin sends an authenticated user here with the standard
 * authorization query. The explicit click is a security boundary — a drive-by
 * link must never silently grant an MCP client access to a workspace.
 */
export default function Consent() {
  const [params] = useSearchParams();
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [submitError, setSubmitError] = useState('');

  const clientId = params.get('client_id') ?? '';
  const scopes = (params.get('scope') ?? '')
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!clientId) {
      setLoadError(t('auth.consent.noClientId'));
      return;
    }
    let alive = true;
    void fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? (r.json() as Promise<ClientSummary>) : Promise.reject()))
      .then((summary) => {
        if (alive) setClient(summary);
      })
      .catch(() => {
        if (alive) setLoadError(t('auth.consent.loadFailed'));
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

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
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('auth.consent.pageTitle') })}</title>
      {loadError ? (
        <AuthHeader title={t('auth.consent.invalidTitle')} subtitle={loadError} />
      ) : (
        <>
          <AuthHeader
            title={t('auth.consent.title')}
            subtitle={
              <>
                <strong className="text-ink">{client?.client_name || clientId}</strong>{' '}
                {t('auth.consent.wantsToConnect')}
              </>
            }
          />
          {client?.client_uri ? (
            <p className="-mt-3 mb-4 text-center font-mono text-xs text-faint">
              {client.client_uri}
            </p>
          ) : null}
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-dim">
            {scopes.map((scope) => (
              <li key={scope}>{scopeCopy(scope)}</li>
            ))}
          </ul>
          {submitError ? (
            <div className="form-error mb-3" role="alert">
              {submitError}
            </div>
          ) : null}
          <div className="flex gap-3">
            <Button className="flex-1" disabled={busy !== null} onClick={() => void decide(true)}>
              {busy === 'approve' ? t('auth.consent.allowing') : t('auth.consent.allow')}
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void decide(false)}
            >
              {busy === 'deny' ? t('auth.consent.denying') : t('auth.consent.deny')}
            </Button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
