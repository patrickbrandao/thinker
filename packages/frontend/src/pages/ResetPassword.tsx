import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthFooter, AuthHeader } from '../components/auth-ui.jsx';
import { Button, Field } from '../components/ui.jsx';
import { authClient } from '../services/auth-client.js';
import { checkEmailConfigured } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

function RequestResetForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Assume email works until the status check says otherwise, so the form
  // renders immediately and only flips to the notice on a confirmed no-provider
  // install (typically self-hosted without EMAIL_PROVIDER set).
  const [emailConfigured, setEmailConfigured] = useState(true);
  const emailId = useId();
  const errorId = useId();

  useEffect(() => {
    let alive = true;
    void checkEmailConfigured().then((ok) => {
      if (alive) setEmailConfigured(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/reset-password',
    });

    setLoading(false);

    if (authError) {
      setError(authError.message ?? t('auth.reset.sendFailed'));
      return;
    }

    setSent(true);
  };

  return (
    <>
      <AuthHeader
        title={t('auth.reset.title')}
        subtitle={
          !emailConfigured
            ? t('auth.reset.noEmail')
            : sent
              ? t('auth.reset.checkEmail')
              : t('auth.reset.enterEmail')
        }
      />

      {!emailConfigured ? (
        <div className="form-notice" role="status">
          {t('auth.reset.unavailableBefore')}{' '}
          <Link to="/account">{t('auth.reset.accountLink')}</Link>{' '}
          {t('auth.reset.unavailableAfter')}
        </div>
      ) : null}

      {emailConfigured && !sent ? (
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          {error ? (
            <div id={errorId} className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <Field label={t('common.email')} htmlFor={emailId}>
            <input
              autoFocus
              id={emailId}
              className="field"
              type="email"
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-describedby={error ? errorId : undefined}
            />
          </Field>
          <Button type="submit" block busy={loading}>
            {t('auth.reset.sendLink')}
          </Button>
        </form>
      ) : null}

      <AuthFooter>
        <Link to="/login">{t('auth.backToSignIn')}</Link>
      </AuthFooter>
    </>
  );
}

function SetNewPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('auth.reset.mismatch'));
      return;
    }

    setLoading(true);

    const { error: authError } = await authClient.resetPassword({ newPassword: password, token });

    setLoading(false);

    if (authError) {
      setError(authError.message ?? t('auth.reset.failed'));
      return;
    }

    setSuccess(true);
  };

  const describedBy = error ? errorId : undefined;

  return (
    <>
      <AuthHeader
        title={t('auth.reset.setNewTitle')}
        subtitle={success ? t('auth.reset.done') : t('auth.reset.enterNew')}
      />

      {success ? (
        <>
          <div className="form-notice">{t('auth.reset.updated')}</div>
          <AuthFooter>
            <Link to="/login">{t('auth.login.submit')}</Link>
          </AuthFooter>
        </>
      ) : (
        <>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            {error ? (
              <div id={errorId} className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            <Field label={t('auth.reset.newPassword')} htmlFor={passwordId}>
              <input
                autoFocus
                id={passwordId}
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder={t('auth.reset.newPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                aria-describedby={describedBy}
              />
            </Field>
            <Field label={t('auth.reset.confirmPassword')} htmlFor={confirmId}>
              <input
                id={confirmId}
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder={t('auth.reset.confirmPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                aria-describedby={describedBy}
              />
            </Field>
            <Button type="submit" block busy={loading}>
              {t('auth.reset.submit')}
            </Button>
          </form>

          <AuthFooter>
            <Link to="/login">{t('auth.backToSignIn')}</Link>
          </AuthFooter>
        </>
      )}
    </>
  );
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <>
      <title>{t('common.pageTitle', { page: t('auth.reset.pageTitle') })}</title>
      <meta name="description" content={t('auth.reset.metaDescription')} />
      {token ? <SetNewPasswordForm token={token} /> : <RequestResetForm />}
    </>
  );
}
