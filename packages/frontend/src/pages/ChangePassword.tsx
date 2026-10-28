import { useEffect, useId, useState, type FormEvent } from 'react';
import { AuthFooter, AuthHeader, authLinkButtonClass } from '../components/auth-ui.jsx';
import { Button, Field } from '../components/ui.jsx';
import { authClient } from '../services/auth-client.js';
import { ApiError } from '../services/api/core.js';
import { changeOwnPassword } from '../services/api/organizations.js';
import { markPasswordChangeRequired } from '../services/org-context.js';
import { loadMe, me } from '../services/session-store.js';
import { useSignal } from '../lib/signal.js';
import { t } from '../i18n/index.js';

/** Client-side checks before the request. Returns an error message or null. */
export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < 8) return t('account.security.tooShort');
  if (next !== confirm) return t('account.security.mismatch');
  if (next === current) return t('account.security.sameAsCurrent');
  return null;
}

/**
 * Forced password change (ADR 0006 §6). Reached when `/me` reports
 * `mustChangePassword` or any API call is refused with
 * `password_change_required`; the rest of the dashboard stays blocked until the
 * change succeeds.
 */
export default function ChangePassword() {
  const profile = useSignal(me);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();

  useEffect(() => {
    if (!me()) void loadMe().catch(() => {});
  }, []);

  const required = profile?.mustChangePassword !== false;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const problem = validateNewPassword(current, next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(current, next, { silent: true });
      markPasswordChangeRequired(false);
      // Full reload: every resource, cache and the session start clean.
      window.location.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message || t('auth.changePassword.incorrect'));
      } else {
        setError(err instanceof Error ? err.message : t('account.security.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    window.location.replace('/login');
  };

  return (
    <>
      <title>{t('common.pageTitle', { page: t('auth.changePassword.pageTitle') })}</title>
      <meta name="description" content={t('auth.changePassword.metaDescription')} />
      <AuthHeader
        title={t('auth.changePassword.title')}
        subtitle={
          required
            ? t('auth.changePassword.requiredSubtitle')
            : t('auth.changePassword.optionalSubtitle')
        }
      />
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <Field
          label={
            required ? t('auth.changePassword.temporary') : t('account.security.currentPassword')
          }
          htmlFor={currentId}
        >
          <input
            id={currentId}
            className="field"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label={t('account.security.newPassword')} htmlFor={nextId}>
          <input
            id={nextId}
            className="field"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <Field label={t('account.security.confirmPassword')} htmlFor={confirmId}>
          <input
            id={confirmId}
            className="field"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <Button type="submit" block busy={busy}>
          {t('account.security.submit')}
        </Button>
      </form>
      <AuthFooter>
        <button type="button" className={authLinkButtonClass} onClick={() => void signOut()}>
          {t('nav.logOut')}
        </button>
      </AuthFooter>
    </>
  );
}
