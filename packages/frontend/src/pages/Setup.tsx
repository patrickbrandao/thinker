import { useNavigate } from '@solidjs/router';
import { Title, Meta } from '@solidjs/meta';
import { type Component, createSignal, onMount, Show } from 'solid-js';
import { authClient } from '../services/auth-client.js';
import { checkNeedsSetup, createFirstAdmin, SetupError } from '../services/setup-status.js';
import { t } from '../i18n/index.js';

const Setup: Component = () => {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [name, setName] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [setupToken, setSetupToken] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [checking, setChecking] = createSignal(true);

  onMount(async () => {
    const needsSetup = await checkNeedsSetup();
    if (!needsSetup) {
      navigate('/login', { replace: true });
      return;
    }
    setChecking(false);
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (password() !== confirmPassword()) {
      setError(t('auth.reset.mismatch'));
      return;
    }
    if (password().length < 8) {
      setError(t('auth.setup.tooShort'));
      return;
    }

    setLoading(true);
    try {
      await createFirstAdmin({
        email: email(),
        name: name(),
        password: password(),
        setupToken: setupToken().trim(),
      });

      // Auto sign-in with the credentials just created.
      const { error: authError } = await authClient.signIn.email({
        email: email(),
        password: password(),
      });
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
      <Title>{t('auth.setup.pageTitle')}</Title>
      <Meta name="description" content={t('auth.setup.metaDescription')} />
      <Show
        when={!checking()}
        fallback={<div class="auth-header__subtitle">{t('common.loading')}</div>}
      >
        <div class="auth-header">
          <h1 class="auth-header__title">{t('auth.setup.title')}</h1>
          <p class="auth-header__subtitle">{t('auth.setup.subtitle')}</p>
        </div>
        <form class="auth-form" onSubmit={handleSubmit}>
          {error() && (
            <div class="auth-form__error" role="alert">
              {error()}
            </div>
          )}
          <label class="auth-form__label">
            {t('auth.setup.token')}
            <input
              class="auth-form__input"
              type="text"
              placeholder={t('auth.setup.tokenPlaceholder')}
              value={setupToken()}
              onInput={(e) => setSetupToken(e.currentTarget.value)}
              required
              autocomplete="off"
              spellcheck={false}
              aria-describedby="setup-token-help"
            />
            <span id="setup-token-help" class="auth-form__hint">
              {t('auth.setup.tokenHelpBefore')} <code>docker compose logs thinker</code>
              {t('auth.setup.tokenHelpAfter')}
            </span>
          </label>
          <label class="auth-form__label">
            {t('common.name')}
            <input
              class="auth-form__input"
              type="text"
              placeholder={t('auth.register.namePlaceholder')}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <label class="auth-form__label">
            {t('common.email')}
            <input
              class="auth-form__input"
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
            />
          </label>
          <label class="auth-form__label">
            {t('common.password')}
            <input
              class="auth-form__input"
              type="password"
              placeholder={t('auth.setup.passwordPlaceholder')}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          <label class="auth-form__label">
            {t('auth.reset.confirmPassword')}
            <input
              class="auth-form__input"
              type="password"
              placeholder={t('auth.setup.confirmPlaceholder')}
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          <button class="auth-form__submit" type="submit" disabled={loading()}>
            {loading() ? <span class="spinner" /> : t('auth.setup.submit')}
          </button>
        </form>
      </Show>
    </>
  );
};

export default Setup;
