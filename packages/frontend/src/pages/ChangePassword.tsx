import { createSignal, onMount, Show, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import { authClient } from '../services/auth-client.js';
import { ApiError } from '../services/api/core.js';
import { changeOwnPassword } from '../services/api/organizations.js';
import { markPasswordChangeRequired } from '../services/org-context.js';
import { loadMe, me } from '../services/session-store.js';

/** Client-side checks before the request. Returns an error message or null. */
export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < 8) return 'New password must be at least 8 characters';
  if (next !== confirm) return 'New passwords do not match';
  if (next === current) return 'New password must differ from the current password';
  return null;
}

/**
 * Forced password change (ADR 0006 §6). Reached when `/me` reports
 * `mustChangePassword` or any API call is refused with
 * `password_change_required`; the rest of the dashboard stays blocked until the
 * change succeeds.
 */
const ChangePassword: Component = () => {
  const [current, setCurrent] = createSignal('');
  const [next, setNext] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    if (!me()) void loadMe().catch(() => {});
  });

  const required = () => me()?.mustChangePassword !== false;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    const problem = validateNewPassword(current(), next(), confirm());
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(current(), next(), { silent: true });
      markPasswordChangeRequired(false);
      // Full reload: every resource, cache and the session start clean.
      window.location.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message || 'The current password is incorrect');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to change password');
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
      <Title>Change password - Thinker</Title>
      <Meta name="description" content="Choose a new password for your Thinker account." />
      <div class="auth-header">
        <h1 class="auth-header__title">Choose a new password</h1>
        <p class="auth-header__subtitle">
          <Show when={required()} fallback="Update the password you use to sign in.">
            Your account uses a temporary password. Choose a new one to continue.
          </Show>
        </p>
      </div>
      <form class="auth-form" onSubmit={handleSubmit}>
        <Show when={error()}>
          <div class="auth-form__error" role="alert">
            {error()}
          </div>
        </Show>
        <label class="auth-form__label">
          {required() ? 'Temporary password' : 'Current password'}
          <input
            class="auth-form__input"
            type="password"
            autocomplete="current-password"
            value={current()}
            onInput={(e) => setCurrent(e.currentTarget.value)}
            required
          />
        </label>
        <label class="auth-form__label">
          New password
          <input
            class="auth-form__input"
            type="password"
            autocomplete="new-password"
            value={next()}
            onInput={(e) => setNext(e.currentTarget.value)}
            required
            minLength={8}
          />
        </label>
        <label class="auth-form__label">
          Confirm new password
          <input
            class="auth-form__input"
            type="password"
            autocomplete="new-password"
            value={confirm()}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            required
            minLength={8}
          />
        </label>
        <button class="auth-form__submit" type="submit" disabled={busy()}>
          {busy() ? <span class="spinner" /> : 'Change password'}
        </button>
      </form>
      <div class="auth-footer">
        <button type="button" class="auth-form__link-btn" onClick={() => void signOut()}>
          Log out
        </button>
      </div>
    </>
  );
};

export default ChangePassword;
