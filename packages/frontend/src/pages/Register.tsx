import { A, useLocation, useNavigate } from '@solidjs/router';
import { Title, Meta } from '@solidjs/meta';
import { type Component, createSignal, createUniqueId, onCleanup, onMount, Show } from 'solid-js';
import SocialButtons from '../components/SocialButtons.jsx';
import { authClient } from '../services/auth-client.js';
import { appendSearch } from '../services/auth-redirects.js';
import { getLastAuthMethod, setLastAuthMethod } from '../services/last-auth-method.js';
import { checkSignupEnabled, checkSocialProviders } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

const RESEND_COOLDOWN_SECONDS = 60;
// New accounts land on the onboarding flow, which hands off to the dashboard.
const POST_SIGNUP_URL = '/welcome';

const Register: Component = () => {
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [emailSent, setEmailSent] = createSignal(false);
  const [alreadyExists, setAlreadyExists] = createSignal(false);
  const [resendCooldown, setResendCooldown] = createSignal(0);
  const [socialProviders, setSocialProviders] = createSignal<string[]>([]);
  const [lastAuthMethod] = createSignal(getLastAuthMethod());
  const location = useLocation();
  const navigate = useNavigate();
  const nameId = createUniqueId();
  const emailId = createUniqueId();
  const passwordId = createUniqueId();
  const errorId = createUniqueId();

  onMount(async () => {
    if (!(await checkSignupEnabled())) {
      // Public sign-up is closed: new accounts come from an admin.
      navigate(appendSearch('/login', location.search), { replace: true });
      return;
    }
    setSocialProviders(await checkSocialProviders());
  });

  let cooldownInterval: ReturnType<typeof setInterval> | undefined;

  const startCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownInterval) clearInterval(cooldownInterval);
    cooldownInterval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownInterval);
          cooldownInterval = undefined;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  onCleanup(() => {
    if (cooldownInterval) clearInterval(cooldownInterval);
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: authError } = await authClient.signUp.email({
      name: name(),
      email: email(),
      password: password(),
      callbackURL: POST_SIGNUP_URL,
    });

    setLoading(false);

    if (authError) {
      if (authError.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
        setAlreadyExists(true);
      }
      setError(authError.message ?? t('auth.register.failed'));
      return;
    }
    setAlreadyExists(false);
    setLastAuthMethod('email');

    if (data?.token) {
      window.location.href = POST_SIGNUP_URL;
      return;
    }

    setEmailSent(true);
    startCooldown();
  };

  const handleResend = async () => {
    if (resendCooldown() > 0) return;

    const { error: resendError } = await authClient.sendVerificationEmail({
      email: email(),
      callbackURL: POST_SIGNUP_URL,
    });

    if (resendError) {
      setError(resendError.message ?? t('auth.resendFailed'));
      return;
    }

    startCooldown();
  };

  return (
    <>
      <Title>{t('common.pageTitle', { page: t('auth.register.pageTitle') })}</Title>
      <Meta name="description" content={t('auth.register.metaDescription')} />
      <Show
        when={!emailSent()}
        fallback={
          <>
            <div class="auth-header">
              <h1 class="auth-header__title">{t('auth.checkEmail')}</h1>
              <p class="auth-header__subtitle">
                {t('auth.register.sentLinkTo')} <strong>{email()}</strong>
              </p>
            </div>

            <div class="auth-form">
              {error() && (
                <div class="auth-form__error" role="alert">
                  {error()}
                </div>
              )}
              <div class="auth-form__success">{t('auth.register.clickLink')}</div>
              <button
                class="auth-form__link-btn"
                onClick={handleResend}
                disabled={resendCooldown() > 0}
              >
                {resendCooldown() > 0
                  ? t('auth.resendIn', { seconds: resendCooldown() })
                  : t('auth.resendVerification')}
              </button>
            </div>

            <div class="auth-footer">
              <A href={appendSearch('/login', location.search)} class="auth-footer__link">
                {t('auth.backToSignIn')}
              </A>
            </div>
          </>
        }
      >
        <div class="auth-header">
          <h1 class="auth-header__title">{t('auth.register.title')}</h1>
          <p class="auth-header__subtitle">{t('auth.register.subtitle')}</p>
        </div>

        <SocialButtons
          enabledProviders={socialProviders()}
          lastUsed={lastAuthMethod()}
          callbackURL={POST_SIGNUP_URL}
        />

        <Show when={socialProviders().length > 0}>
          <div class="auth-divider">
            <span class="auth-divider__text">{t('auth.or')}</span>
          </div>
        </Show>

        <form class="auth-form" onSubmit={handleSubmit}>
          <Show when={alreadyExists()}>
            <div id={errorId} class="auth-form__error" role="alert">
              {t('auth.register.alreadyExists')}{' '}
              <A href={appendSearch('/login', location.search)} class="auth-form__error-link">
                {t('auth.register.signIn')}
              </A>{' '}
              {t('auth.or')}{' '}
              <A href="/reset-password" class="auth-form__error-link">
                {t('auth.register.resetPassword')}
              </A>
              .
            </div>
          </Show>
          <Show when={error() && !alreadyExists()}>
            <div id={errorId} class="auth-form__error" role="alert">
              {error()}
            </div>
          </Show>
          <label class="auth-form__label" for={nameId}>
            {t('common.name')}
            <input
              ref={(el) => requestAnimationFrame(() => el.focus())}
              id={nameId}
              class="auth-form__input"
              type="text"
              autocomplete="name"
              placeholder={t('auth.register.namePlaceholder')}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              required
              aria-describedby={error() ? errorId : undefined}
            />
          </label>
          <label class="auth-form__label" for={emailId}>
            {t('common.email')}
            <input
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
          <label class="auth-form__label" for={passwordId}>
            {t('common.password')}
            <input
              id={passwordId}
              class="auth-form__input"
              type="password"
              autocomplete="new-password"
              placeholder={t('auth.register.passwordPlaceholder')}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={8}
              aria-describedby={error() ? errorId : undefined}
            />
          </label>
          <button class="auth-form__submit" type="submit" disabled={loading()}>
            {loading() ? <span class="spinner" /> : t('auth.register.submit')}
          </button>
        </form>
        <div class="auth-footer">
          <span>{t('auth.register.haveAccount')} </span>
          <A href={appendSearch('/login', location.search)} class="auth-footer__link">
            {t('auth.register.signIn')}
          </A>
        </div>
      </Show>
    </>
  );
};

export default Register;
