import { createResource, createSignal, For, onMount, Show, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Title, Meta } from '@solidjs/meta';
import { authClient } from '../services/auth-client.js';
import { toast } from '../services/toast-store.js';
import { LOCALES, LOCALE_NAMES, locale, setLocale, t } from '../i18n/index.js';

const Account: Component = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [copied, setCopied] = createSignal(false);
  const [theme, setTheme] = createSignal<'light' | 'dark' | 'system'>('system');
  const [currentPassword, setCurrentPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [pwError, setPwError] = createSignal('');
  const [pwBusy, setPwBusy] = createSignal(false);

  const handleChangePassword = async (e: Event) => {
    e.preventDefault();
    setPwError('');

    const current = currentPassword();
    const next = newPassword();

    if (next !== confirmPassword()) {
      setPwError(t('account.security.mismatch'));
      return;
    }
    if (next.length < 8) {
      setPwError(t('account.security.tooShort'));
      return;
    }
    if (next === current) {
      setPwError(t('account.security.sameAsCurrent'));
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });

      if (error) {
        setPwError(error.message ?? t('account.security.failed'));
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('account.security.changed'));
    } catch {
      setPwError(t('account.security.failed'));
    } finally {
      setPwBusy(false);
    }
  };
  const [accounts] = createResource(() => authClient.listAccounts());
  const hasCredentialAccount = () =>
    (accounts()?.data ?? []).some((a) => a.providerId === 'credential');

  const userName = () => session()?.data?.user?.name ?? '';
  const userEmail = () => session()?.data?.user?.email ?? '';
  const userId = () => session()?.data?.user?.id ?? '';

  onMount(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored);
    } else {
      setTheme('system');
    }
  });

  const applyTheme = (value: 'light' | 'dark' | 'system') => {
    setTheme(value);
    if (value === 'system') {
      localStorage.removeItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', prefersDark);
    } else {
      localStorage.setItem('theme', value);
      document.documentElement.classList.toggle('dark', value === 'dark');
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(userId());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="account-modal">
      <Title>{t('common.pageTitle', { page: t('account.title') })}</Title>
      <Meta name="description" content={t('account.metaDescription')} />
      <div class="account-modal__inner">
        <button class="btn btn--ghost btn--sm account-back-btn" onClick={() => navigate(-1)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M14.71 7.29a.996.996 0 0 0-1.41 0l-4 4a.996.996 0 0 0 0 1.41l4 4c.2.2.45.29.71.29s.51-.1.71-.29a.996.996 0 0 0 0-1.41L11.43 12l3.29-3.29a.996.996 0 0 0 0-1.41Z" />
          </svg>
          {t('common.back')}
        </button>
        <div class="page-header">
          <div>
            <h1>{t('account.title')}</h1>
            <span class="breadcrumb">{t('account.subtitle')}</span>
          </div>
        </div>

        {/* Profile Information */}
        <h2 class="settings-section__title">{t('account.profile.title')}</h2>

        <div class="settings-card">
          <div class="settings-card__row">
            <div class="settings-card__label">
              <span class="settings-card__label-title">{t('account.profile.displayName')}</span>
              <span class="settings-card__label-desc">{t('account.profile.displayNameDesc')}</span>
            </div>
            <div class="settings-card__control">
              <input
                class="settings-card__input"
                type="text"
                aria-label={t('account.profile.displayName')}
                value={userName()}
                readonly
              />
            </div>
          </div>
          <div class="settings-card__row">
            <div class="settings-card__label">
              <span class="settings-card__label-title">{t('account.profile.email')}</span>
              <span class="settings-card__label-desc">{t('account.profile.emailDesc')}</span>
            </div>
            <div class="settings-card__control">
              <input
                class="settings-card__input"
                type="email"
                aria-label={t('account.profile.email')}
                value={userEmail()}
                readonly
              />
            </div>
          </div>
          <div class="settings-card__footer">
            <span style="font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
              {t('account.profile.managedBy')}
            </span>
          </div>
        </div>

        {/* Security */}
        <Show when={hasCredentialAccount()}>
          <h2 class="settings-section__title">{t('account.security.title')}</h2>

          <form class="settings-card" onSubmit={handleChangePassword}>
            <div class="settings-card__row">
              <div class="settings-card__label">
                <span class="settings-card__label-title">
                  {t('account.security.currentPassword')}
                </span>
                <span class="settings-card__label-desc">
                  {t('account.security.currentPasswordDesc')}
                </span>
              </div>
              <div class="settings-card__control">
                <input
                  class="settings-card__input"
                  type="password"
                  autocomplete="current-password"
                  aria-label={t('account.security.currentPassword')}
                  value={currentPassword()}
                  onInput={(e) => setCurrentPassword(e.currentTarget.value)}
                  required
                />
              </div>
            </div>
            <div class="settings-card__row">
              <div class="settings-card__label">
                <span class="settings-card__label-title">{t('account.security.newPassword')}</span>
                <span class="settings-card__label-desc">
                  {t('account.security.newPasswordDesc')}
                </span>
              </div>
              <div class="settings-card__control">
                <input
                  class="settings-card__input"
                  type="password"
                  autocomplete="new-password"
                  aria-label={t('account.security.newPassword')}
                  value={newPassword()}
                  onInput={(e) => setNewPassword(e.currentTarget.value)}
                  required
                  minLength={8}
                />
              </div>
            </div>
            <div class="settings-card__row">
              <div class="settings-card__label">
                <span class="settings-card__label-title">
                  {t('account.security.confirmPassword')}
                </span>
                <span class="settings-card__label-desc">
                  {t('account.security.confirmPasswordDesc')}
                </span>
              </div>
              <div class="settings-card__control">
                <input
                  class="settings-card__input"
                  type="password"
                  autocomplete="new-password"
                  aria-label={t('account.security.confirmPassword')}
                  value={confirmPassword()}
                  onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                  required
                  minLength={8}
                />
              </div>
            </div>
            <div class="settings-card__footer account-security-footer">
              <span class="account-security-error" role="alert">
                {pwError()}
              </span>
              <button class="btn btn--primary btn--sm" type="submit" disabled={pwBusy()}>
                {pwBusy() ? <span class="spinner" /> : t('account.security.submit')}
              </button>
            </div>
          </form>
        </Show>

        {/* Workspace ID */}
        <h2 class="settings-section__title">{t('account.workspace.title')}</h2>

        <div class="settings-card">
          <div class="settings-card__body">
            <p class="settings-card__desc">{t('account.workspace.desc')}</p>
            <div class="settings-card__id-row">
              <code class="settings-card__id-value">{userId()}</code>
              <button
                class="settings-card__copy-btn"
                onClick={copyId}
                title={t('common.copy')}
                aria-label={copied() ? t('common.copied') : t('account.workspace.copyId')}
              >
                {copied() ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <h2 class="settings-section__title">{t('account.appearance.title')}</h2>

        <div class="settings-card">
          <div class="settings-card__body">
            <p class="settings-card__desc">{t('account.appearance.desc')}</p>
            <div class="theme-picker">
              <button
                class="theme-picker__option"
                classList={{ 'theme-picker__option--active': theme() === 'light' }}
                onClick={() => applyTheme('light')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
                {t('account.appearance.light')}
              </button>
              <button
                class="theme-picker__option"
                classList={{ 'theme-picker__option--active': theme() === 'dark' }}
                onClick={() => applyTheme('dark')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
                {t('account.appearance.dark')}
              </button>
              <button
                class="theme-picker__option"
                classList={{ 'theme-picker__option--active': theme() === 'system' }}
                onClick={() => applyTheme('system')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8" />
                  <path d="M12 17v4" />
                </svg>
                {t('account.appearance.system')}
              </button>
            </div>
          </div>
        </div>

        {/* Language */}
        <h2 class="settings-section__title">{t('account.language.title')}</h2>

        <div class="settings-card">
          <div class="settings-card__body">
            <p class="settings-card__desc">{t('account.language.desc')}</p>
            <div class="theme-picker" role="group" aria-label={t('account.language.label')}>
              <For each={LOCALES}>
                {(l) => (
                  <button
                    class="theme-picker__option"
                    classList={{ 'theme-picker__option--active': locale() === l }}
                    aria-pressed={locale() === l}
                    lang={l}
                    onClick={() => setLocale(l)}
                  >
                    {LOCALE_NAMES[l]}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Account;
