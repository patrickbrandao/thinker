import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AuthHeader } from '../components/auth-ui.jsx';
import { Button, Field } from '../components/ui.jsx';
import { authClient } from '../services/auth-client.js';
import { checkNeedsSetup, createFirstAdmin, SetupError } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

export default function Setup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const tokenId = useId();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

  useEffect(() => {
    let alive = true;
    void checkNeedsSetup().then((needsSetup) => {
      if (!alive) return;
      if (!needsSetup) {
        navigate('/login', { replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('auth.reset.mismatch'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.setup.tooShort'));
      return;
    }

    setLoading(true);
    try {
      await createFirstAdmin({ email, name, password, setupToken: setupToken.trim() });

      // Auto sign-in with the credentials just created.
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        // Creation succeeded but sign-in failed: a manual login lands on the
        // dashboard home like any other sign-in.
        navigate('/login', { replace: true });
        return;
      }
      // Full reload so the new session cookie is picked up by every guard.
      window.location.href = '/';
    } catch (err) {
      if (err instanceof SetupError && err.status === 403) {
        setError(t('auth.setup.invalidToken'));
      } else {
        setError(err instanceof Error ? err.message : t('auth.setup.failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <title>{t('auth.setup.pageTitle')}</title>
      <meta name="description" content={t('auth.setup.metaDescription')} />
      {checking ? (
        <p className="text-center text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <AuthHeader title={t('auth.setup.title')} subtitle={t('auth.setup.subtitle')} />
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            <Field
              label={t('auth.setup.token')}
              htmlFor={tokenId}
              hint={
                <span id="setup-token-help">
                  {t('auth.setup.tokenHelpBefore')} <code>docker compose logs thinker</code>
                  {t('auth.setup.tokenHelpAfter')}
                </span>
              }
            >
              <input
                id={tokenId}
                className="field"
                type="text"
                placeholder={t('auth.setup.tokenPlaceholder')}
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
                aria-describedby="setup-token-help"
              />
            </Field>
            <Field label={t('common.name')} htmlFor={nameId}>
              <input
                id={nameId}
                className="field"
                type="text"
                placeholder={t('auth.register.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={100}
              />
            </Field>
            <Field label={t('common.email')} htmlFor={emailId}>
              <input
                id={emailId}
                className="field"
                type="email"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label={t('common.password')} htmlFor={passwordId}>
              <input
                id={passwordId}
                className="field"
                type="password"
                placeholder={t('auth.setup.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={128}
              />
            </Field>
            <Field label={t('auth.reset.confirmPassword')} htmlFor={confirmId}>
              <input
                id={confirmId}
                className="field"
                type="password"
                placeholder={t('auth.setup.confirmPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                maxLength={128}
              />
            </Field>
            <Button type="submit" block busy={loading}>
              {t('auth.setup.submit')}
            </Button>
          </form>
        </>
      )}
    </>
  );
}
