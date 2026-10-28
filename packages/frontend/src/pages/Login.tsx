import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import SocialButtons from '../components/SocialButtons.jsx';
import {
  AuthDivider,
  AuthFooter,
  AuthHeader,
  authLinkButtonClass,
} from '../components/auth-ui.jsx';
import { Button, Field } from '../components/ui.jsx';
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

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
  const [lastAuthMethod] = useState(getLastAuthMethod);
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const code = searchParams.get('error');
    if (code === 'account_not_linked') {
      setNeedsVerification(true);
      setError(t('auth.login.accountNotLinked'));
    } else if (code === 'signup_disabled' || code === 'unable_to_create_user') {
      setError(t('auth.login.signupDisabled'));
    } else if (code || searchParams.get('oauth') === 'failed') {
      setError(t('auth.login.oauthFailed'));
    }
    void Promise.all([checkSocialProviders(), checkSignupEnabled()]).then(([providers, signup]) => {
      if (!alive) return;
      setSocialProviders(providers);
      setSignupEnabled(signup);
    });
    return () => {
      alive = false;
    };
    // Mount only: the error comes from the callback URL the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    },
    [],
  );

  const startCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    cooldownInterval.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownInterval.current);
          cooldownInterval.current = undefined;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNeedsVerification(false);
    setLoading(true);

    const { error: authError } = await authClient.signIn.email({ email, password });

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
    window.location.href = getAuthDestination(Object.fromEntries(searchParams), location.search);
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
    if (resendCooldown > 0) return;
    if (!email.trim()) {
      setError(t('auth.login.enterEmailForLink'));
      return;
    }

    const { error: resendError } = await authClient.sendVerificationEmail({
      email,
      callbackURL: getAuthDestination(Object.fromEntries(searchParams), location.search),
    });

    if (resendError) {
      setError(resendError.message ?? t('auth.resendFailed'));
      return;
    }

    startCooldown();
    setError(t('auth.login.verificationSent'));
  };

  const describedBy = error ? errorId : undefined;

  return (
    <>
      <title>{t('common.pageTitle', { page: t('auth.login.pageTitle') })}</title>
      <meta name="description" content={t('auth.login.metaDescription')} />
      <AuthHeader title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} />

      <SocialButtons enabledProviders={socialProviders} lastUsed={lastAuthMethod} />

      {socialProviders.length > 0 ? <AuthDivider /> : null}

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {import.meta.env.DEV && DevSignInButton ? (
          <Suspense fallback={null}>
            <DevSignInButton disabled={loading} onSignIn={signInAsDev} />
          </Suspense>
        ) : null}
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
            aria-describedby={describedBy}
          />
        </Field>
        {needsVerification ? (
          <button
            type="button"
            className={authLinkButtonClass}
            onClick={handleResendVerification}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0
              ? t('auth.resendIn', { seconds: resendCooldown })
              : t('auth.sendVerification')}
          </button>
        ) : null}
        <Field label={t('common.password')} htmlFor={passwordId}>
          <input
            id={passwordId}
            className="field"
            type="password"
            autoComplete="current-password"
            placeholder={t('auth.login.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-describedby={describedBy}
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/reset-password" className="text-sm">
            {t('auth.login.forgot')}
          </Link>
        </div>
        <Button type="submit" block busy={loading}>
          {t('auth.login.submit')}
        </Button>
      </form>
      {signupEnabled ? (
        <AuthFooter>
          {t('auth.login.noAccount')}{' '}
          <Link to={appendSearch('/register', location.search)}>{t('auth.login.signUp')}</Link>
        </AuthFooter>
      ) : null}
    </>
  );
}
