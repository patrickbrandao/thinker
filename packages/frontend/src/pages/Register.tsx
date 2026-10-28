import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import SocialButtons from '../components/SocialButtons.jsx';
import {
  AuthDivider,
  AuthFooter,
  AuthHeader,
  authLinkButtonClass,
} from '../components/auth-ui.jsx';
import { Button, Field } from '../components/ui.jsx';
import { authClient } from '../services/auth-client.js';
import { appendSearch } from '../services/auth-redirects.js';
import { getLastAuthMethod, setLastAuthMethod } from '../services/last-auth-method.js';
import { checkSignupEnabled, checkSocialProviders } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

const RESEND_COOLDOWN_SECONDS = 60;
// New accounts land on the onboarding flow, which hands off to the dashboard.
const POST_SIGNUP_URL = '/welcome';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
  const [lastAuthMethod] = useState(getLastAuthMethod);
  const location = useLocation();
  const navigate = useNavigate();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await checkSignupEnabled())) {
        // Public sign-up is closed: new accounts come from an admin.
        if (alive) navigate(appendSearch('/login', location.search), { replace: true });
        return;
      }
      const providers = await checkSocialProviders();
      if (alive) setSocialProviders(providers);
    })();
    return () => {
      alive = false;
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setLoading(true);

    const { data, error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
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
    if (resendCooldown > 0) return;

    const { error: resendError } = await authClient.sendVerificationEmail({
      email,
      callbackURL: POST_SIGNUP_URL,
    });

    if (resendError) {
      setError(resendError.message ?? t('auth.resendFailed'));
      return;
    }

    startCooldown();
  };

  const loginHref = appendSearch('/login', location.search);
  const describedBy = error ? errorId : undefined;

  const head = (
    <>
      <title>{t('common.pageTitle', { page: t('auth.register.pageTitle') })}</title>
      <meta name="description" content={t('auth.register.metaDescription')} />
    </>
  );

  if (emailSent)
    return (
      <>
        {head}
        <AuthHeader
          title={t('auth.checkEmail')}
          subtitle={
            <>
              {t('auth.register.sentLinkTo')} <strong className="text-ink">{email}</strong>
            </>
          }
        />
        <div className="flex flex-col gap-3">
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="form-notice">{t('auth.register.clickLink')}</div>
          <button
            type="button"
            className={authLinkButtonClass}
            onClick={handleResend}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0
              ? t('auth.resendIn', { seconds: resendCooldown })
              : t('auth.resendVerification')}
          </button>
        </div>
        <AuthFooter>
          <Link to={loginHref}>{t('auth.backToSignIn')}</Link>
        </AuthFooter>
      </>
    );

  return (
    <>
      {head}
      <AuthHeader title={t('auth.register.title')} subtitle={t('auth.register.subtitle')} />

      <SocialButtons
        enabledProviders={socialProviders}
        lastUsed={lastAuthMethod}
        callbackURL={POST_SIGNUP_URL}
      />

      {socialProviders.length > 0 ? <AuthDivider /> : null}

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {alreadyExists ? (
          <div id={errorId} className="form-error" role="alert">
            {t('auth.register.alreadyExists')}{' '}
            <Link to={loginHref} className="font-medium text-danger underline">
              {t('auth.register.signIn')}
            </Link>{' '}
            {t('auth.or')}{' '}
            <Link to="/reset-password" className="font-medium text-danger underline">
              {t('auth.register.resetPassword')}
            </Link>
            .
          </div>
        ) : error ? (
          <div id={errorId} className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <Field label={t('common.name')} htmlFor={nameId}>
          <input
            autoFocus
            id={nameId}
            className="field"
            type="text"
            autoComplete="name"
            placeholder={t('auth.register.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-describedby={describedBy}
          />
        </Field>
        <Field label={t('common.email')} htmlFor={emailId}>
          <input
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
        <Field label={t('common.password')} htmlFor={passwordId}>
          <input
            id={passwordId}
            className="field"
            type="password"
            autoComplete="new-password"
            placeholder={t('auth.register.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            aria-describedby={describedBy}
          />
        </Field>
        <Button type="submit" block busy={loading}>
          {t('auth.register.submit')}
        </Button>
      </form>
      <AuthFooter>
        {t('auth.register.haveAccount')} <Link to={loginHref}>{t('auth.register.signIn')}</Link>
      </AuthFooter>
    </>
  );
}
