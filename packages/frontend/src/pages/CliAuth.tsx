import { useState } from 'react';
import { useSearchParams } from 'react-router';
import AuthLayout from '../layouts/AuthLayout.jsx';
import { AuthHeader } from '../components/auth-ui.jsx';
import { Button } from '../components/ui.jsx';
import { fetchMutate } from '../services/api/core.js';
import { t } from '../i18n/index.js';

/** Mirrors the backend's `state` contract on POST /api/v1/cli/authorize. */
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
/** Mirrors the backend's PKCE `code_challenge` contract (S256 output is 43 chars). */
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_METHOD = 'S256';
/** The CLI listens on an ephemeral unprivileged loopback port. */
const PORT_RE = /^\d{1,5}$/;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

interface CliRequest {
  port: number;
  state: string;
  codeChallenge: string;
}

/** The whole request, or null if any part is unusable. */
function parseRequest(params: URLSearchParams): CliRequest | null {
  const rawPort = params.get('port') ?? '';
  const parsedPort = PORT_RE.test(rawPort) ? Number(rawPort) : NaN;
  const port = parsedPort >= MIN_PORT && parsedPort <= MAX_PORT ? parsedPort : null;

  const rawState = params.get('state') ?? '';
  const state = STATE_RE.test(rawState) ? rawState : null;

  // PKCE S256 challenge; the method is pinned (only S256 is accepted).
  const rawChallenge = params.get('code_challenge') ?? '';
  const method = params.get('code_challenge_method') ?? CHALLENGE_METHOD;
  const codeChallenge =
    CODE_CHALLENGE_RE.test(rawChallenge) && method === CHALLENGE_METHOD ? rawChallenge : null;

  return port !== null && state !== null && codeChallenge !== null
    ? { port, state, codeChallenge }
    : null;
}

/**
 * Browser half of `thinker login`: confirms the user wants to grant the CLI on
 * this machine a workspace token, then hands a one-time code to the CLI's
 * loopback listener. The explicit click is a security boundary — a drive-by
 * link must never silently mint a token.
 */
export default function CliAuth() {
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  // One value so the button's visibility and the values `authorize` sends can
  // never disagree.
  const request = parseRequest(params);

  const authorize = async () => {
    // Snapshot every param before the await: the callback URL must echo exactly
    // the state we POSTed. The button only renders when `request` is non-null.
    const { port: loopbackPort, state: requestState, codeChallenge: requestChallenge } = request!;
    setPhase('working');
    try {
      const { code } = await fetchMutate<{ code: string }>('/cli/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: requestState,
          code_challenge: requestChallenge,
          code_challenge_method: CHALLENGE_METHOD,
        }),
      });
      // Hand the one-time code back over loopback. The CLI exchanges it for the
      // token itself, so nothing long-lived ever rides in this URL.
      window.location.assign(
        `http://127.0.0.1:${loopbackPort}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(requestState)}`,
      );
      setPhase('done');
    } catch (err) {
      // Nothing was consumed server-side on a failure, so the user can retry.
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('auth.cli.pageTitle') })}</title>
      {!request ? (
        <AuthHeader
          title={t('auth.cli.invalidTitle')}
          subtitle={
            <>
              {t('auth.cli.invalidBefore')} <code>thinker login</code> {t('auth.cli.invalidAfter')}
            </>
          }
        />
      ) : phase === 'done' ? (
        <AuthHeader title={t('auth.cli.connected')} subtitle={t('auth.cli.closePage')} />
      ) : (
        <>
          <AuthHeader
            title={t('auth.cli.title')}
            subtitle={
              <>
                {t('auth.cli.grantBefore')} <code>thinker logout</code>
                {t('auth.cli.grantAfter')}
              </>
            }
          />
          <div className="flex flex-col gap-3">
            {/* A failed authorize consumed nothing server-side, so the error
                is shown above a live button rather than replacing it. */}
            {phase === 'error' ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            <Button block onClick={authorize} disabled={phase === 'working'}>
              {phase === 'working'
                ? t('auth.cli.authorizing')
                : phase === 'error'
                  ? t('common.tryAgain')
                  : t('auth.cli.authorize')}
            </Button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
