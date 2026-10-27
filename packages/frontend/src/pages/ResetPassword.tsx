import { A, useSearchParams } from '@solidjs/router';
import { Title, Meta } from '@solidjs/meta';
import { type Component, createSignal, createUniqueId, onMount, Show } from 'solid-js';
import { authClient } from '../services/auth-client.js';
import { checkEmailConfigured } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

const RequestResetForm: Component = () => {
  const [email, setEmail] = createSignal('');
  const [sent, setSent] = createSignal(false);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  // Assume email works until the status check says otherwise, so the form
  // renders immediately and only flips to the notice on a confirmed no-provider
  // install (typically self-hosted without EMAIL_PROVIDER set).
  const [emailConfigured, setEmailConfigured] = createSignal(true);
  const emailId = createUniqueId();
  const errorId = createUniqueId();

  onMount(() => {
    void checkEmailConfigured().then(setEmailConfigured);
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await authClient.requestPasswordReset({
      email: email(),
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
      <div class="auth-header">
        <h1 class="auth-header__title">{t('auth.reset.title')}</h1>
        <p class="auth-header__subtitle">
          {!emailConfigured()
            ? t('auth.reset.noEmail')
            : sent()
              ? t('auth.reset.checkEmail')
              : t('auth.reset.enterEmail')}
        </p>
      </div>

      <Show when={!emailConfigured()}>
        <div class="auth-form">
          <div class="auth-form__notice" role="status">
            {t('auth.reset.unavailableBefore')}{' '}
            <A href="/account" class="auth-form__notice-link">
              {t('auth.reset.accountLink')}
            </A>{' '}
            {t('auth.reset.unavailableAfter')}
          </div>
        </div>
      </Show>

      <Show when={emailConfigured() && !sent()}>
        <form class="auth-form" onSubmit={handleSubmit}>
          {error() && (
            <div id={errorId} class="auth-form__error" role="alert">
              {error()}
            </div>
          )}
          <label class="auth-form__label" for={emailId}>
            {t('common.email')}
            <input
              ref={(el) => requestAnimationFrame(() => el.focus())}
              id={emailId}
              class="auth-form__input"
              type="email"
              autocomplete="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
              aria-describedby={error() ? errorId : undefined}
            />
          </label>
          <button class="auth-form__submit" type="submit" disabled={loading()}>
            {loading() ? <span class="spinner" /> : t('auth.reset.sendLink')}
          </button>
        </form>
      </Show>

      <div class="auth-footer">
        <A href="/login" class="auth-footer__link">
          {t('auth.backToSignIn')}
        </A>
      </div>
    </>
  );
};

const SetNewPasswordForm: Component<{ token: string }> = (props) => {
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [success, setSuccess] = createSignal(false);
  const passwordId = createUniqueId();
  const confirmId = createUniqueId();
  const errorId = createUniqueId();

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (password() !== confirmPassword()) {
      setError(t('auth.reset.mismatch'));
      return;
    }

    setLoading(true);

    const { error: authError } = await authClient.resetPassword({
      newPassword: password(),
      token: props.token,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message ?? t('auth.reset.failed'));
      return;
    }

    setSuccess(true);
  };

  return (
    <>
      <div class="auth-header">
        <h1 class="auth-header__title">{t('auth.reset.setNewTitle')}</h1>
        <p class="auth-header__subtitle">
          {success() ? t('auth.reset.done') : t('auth.reset.enterNew')}
        </p>
      </div>

      <Show
        when={!success()}
        fallback={
          <>
            <div class="auth-form">
              <div class="auth-form__success">{t('auth.reset.updated')}</div>
            </div>
            <div class="auth-footer">
              <A href="/login" class="auth-footer__link">
                {t('auth.login.submit')}
              </A>
            </div>
          </>
        }
      >
        <form class="auth-form" onSubmit={handleSubmit}>
          {error() && (
            <div id={errorId} class="auth-form__error" role="alert">
              {error()}
            </div>
          )}
          <label class="auth-form__label" for={passwordId}>
            {t('auth.reset.newPassword')}
            <input
              ref={(el) => requestAnimationFrame(() => el.focus())}
              id={passwordId}
              class="auth-form__input"
              type="password"
              autocomplete="new-password"
              placeholder={t('auth.reset.newPlaceholder')}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={8}
              aria-describedby={error() ? errorId : undefined}
            />
          </label>
          <label class="auth-form__label" for={confirmId}>
            {t('auth.reset.confirmPassword')}
            <input
              id={confirmId}
              class="auth-form__input"
              type="password"
              autocomplete="new-password"
              placeholder={t('auth.reset.confirmPlaceholder')}
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              required
              minLength={8}
              aria-describedby={error() ? errorId : undefined}
            />
          </label>
          <button class="auth-form__submit" type="submit" disabled={loading()}>
            {loading() ? <span class="spinner" /> : t('auth.reset.submit')}
          </button>
        </form>

        <div class="auth-footer">
          <A href="/login" class="auth-footer__link">
            {t('auth.backToSignIn')}
          </A>
        </div>
      </Show>
    </>
  );
};

const ResetPassword: Component = () => {
  const [searchParams] = useSearchParams();
  const token = () => searchParams.token as string | undefined;

  return (
    <>
      <Title>{t('common.pageTitle', { page: t('auth.reset.pageTitle') })}</Title>
      <Meta name="description" content={t('auth.reset.metaDescription')} />
      <Show when={token()} fallback={<RequestResetForm />}>
        {(tok) => <SetNewPasswordForm token={tok()} />}
      </Show>
    </>
  );
};

export default ResetPassword;
