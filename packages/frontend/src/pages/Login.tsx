import { A, useLocation, useSearchParams } from '@solidjs/router';
import { Title, Meta } from '@solidjs/meta';
import {
  type Component,
  createSignal,
  createUniqueId,
  lazy,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import SocialButtons from '../components/SocialButtons.jsx';
import { authClient } from '../services/auth-client.js';
import { appendSearch, getAuthDestination } from '../services/auth-redirects.js';
import { getLastAuthMethod, setLastAuthMethod } from '../services/last-auth-method.js';
import { checkSignupEnabled, checkSocialProviders } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

const RESEND_COOLDOWN_SECONDS = 60;

// Dev-only seed-admin shortcut. The dynamic import sits inside the
// `import.meta.env.DEV` branch, so production builds drop the module together
// with the seed credentials and the button template (#229).
const DevSignInButton = import.meta.env.DEV
  ? lazy(() => import('../components/DevSignInButton.jsx'))
  : null;

const Login: Component = () => {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [needsVerification, setNeedsVerification] = createSignal(false);
  const [resendCooldown, setResendCooldown] = createSignal(0);
  const [socialProviders, setSocialProviders] = createSignal<string[]>([]);
  const [lastAuthMethod] = createSignal(getLastAuthMethod());
  const [signupEnabled, setSignupEnabled] = createSignal(false);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const emailId = createUniqueId();
  const passwordId = createUniqueId();
  const errorId = createUniqueId();

  onMount(async () => {
    if (searchParams.error === 'account_not_linked') {
      setNeedsVerification(true);
      setError(t('auth.login.accountNotLinked'));
    } else if (
      searchParams.error === 'signup_disabled' ||
      searchParams.error === 'unable_to_create_user'
    ) {
      setError(t('auth.login.signupDisabled'));
    } else if (searchParams.error || searchParams.oauth === 'failed') {
      setError(t('auth.login.oauthFailed'));
    }
    const [providers, signup] = await Promise.all([checkSocialProviders(), checkSignupEnabled()]);
    setSocialProviders(providers);
    setSignupEnabled(signup);
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
    setNeedsVerification(false);
    setLoading(true);

    const { error: authError } = await authClient.signIn.email({
      email: email(),
      password: password(),
    });

    setLoading(false);

    if (authError) {
      const msg = authError.message ?? '';
      if (
        msg.toLowerCase().includes('email is not verified') ||
        authError.code === 'EMAIL_NOT_VERIFIED'
      ) {
        setNeedsVerification(true);
        setError(t('auth.login.verifyFirst'));
        return;
      }
      setError(msg || t('auth.login.invalid'));
      return;
    }

    setLastAuthMethod('email');
    window.location.href = getAuthDestination(searchParams, location.search);
  };

  // Dev shortcut: fill + submit the seed admin. One click, no credentials in the URL;
  // the credentials live in DevSignInButton, which production builds never include.
  const signInAsDev = async (devEmail: string, devPassword: string) => {
    setEmail(devEmail);
    setPassword(devPassword);
    setError('');
    setLoading(true);
    const { error: authError } = await authClient.signIn.email({
      email: devEmail,
      password: devPassword,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message ?? t('auth.login.devFailed'));
      return;
    }
    setLastAuthMethod('email');
    window.location.href = '/';
  };

  const handleResendVerification = async () => {
    if (resendCooldown() > 0) return;
    if (!email().trim()) {
      setError(t('auth.login.enterEmailForLink'));
      return;
    }

    const { error: resendError } = await authClient.sendVerificationEmail({
      email: email(),
      callbackURL: getAuthDestination(searchParams, location.search),
    });

    if (resendError) {
      setError(resendError.message ?? t('auth.resendFailed'));
      return;
    }

    startCooldown();
    setError(t('auth.login.verificationSent'));
  };

  return (
    <>
      <Title>{t('common.pageTitle', { page: t('auth.login.pageTitle') })}</Title>
      <Meta name="description" content={t('auth.login.metaDescription')} />
      <div class="auth-header">
        <h1 class="auth-header__title">{t('auth.login.title')}</h1>
        <p class="auth-header__subtitle">{t('auth.login.subtitle')}</p>
      </div>

      <SocialButtons enabledProviders={socialProviders()} lastUsed={lastAuthMethod()} />

      <Show when={socialProviders().length > 0}>
        <div class="auth-divider">
          <span class="auth-divider__text">{t('auth.or')}</span>
        </div>
      </Show>

      <form class="auth-form" onSubmit={handleSubmit}>
        {import.meta.env.DEV && DevSignInButton && (
          <DevSignInButton disabled={loading()} onSignIn={signInAsDev} />
        )}
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
        <Show when={needsVerification()}>
          <button
            type="button"
            class="auth-form__link-btn"
            onClick={handleResendVerification}
            disabled={resendCooldown() > 0}
          >
            {resendCooldown() > 0
              ? t('auth.resendIn', { seconds: resendCooldown() })
              : t('auth.sendVerification')}
          </button>
        </Show>
        <label class="auth-form__label" for={passwordId}>
          {t('common.password')}
          <input
            id={passwordId}
            class="auth-form__input"
            type="password"
            autocomplete="current-password"
            placeholder={t('auth.login.passwordPlaceholder')}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            required
            aria-describedby={error() ? errorId : undefined}
          />
        </label>
        <div class="auth-form__actions">
          <A href="/reset-password" class="auth-form__forgot">
            {t('auth.login.forgot')}
          </A>
        </div>
        <button class="auth-form__submit" type="submit" disabled={loading()}>
          {loading() ? <span class="spinner" /> : t('auth.login.submit')}
        </button>
      </form>
      <Show when={signupEnabled()}>
        <div class="auth-footer">
          <span>{t('auth.login.noAccount')} </span>
          <A href={appendSearch('/register', location.search)} class="auth-footer__link">
            {t('auth.login.signUp')}
          </A>
        </div>
      </Show>
    </>
  );
};

export default Login;
