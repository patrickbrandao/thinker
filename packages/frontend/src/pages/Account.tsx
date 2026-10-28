import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, Monitor, Moon, Sun } from 'lucide-react';
import { authClient } from '../services/auth-client.js';
import { toast } from '../services/toast-store.js';
import { LOCALES, LOCALE_NAMES, setLocale, t, useLocale } from '../i18n/index.js';
import { setThemePreference, themePreference, type ThemePreference } from '../lib/theme.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import CopyButton from '../components/CopyButton.js';
import { Button, Field, Panel } from '../components/ui.js';

const THEMES: Array<{ value: ThemePreference; label: () => string; icon: ReactNode }> = [
  { value: 'light', label: () => t('account.appearance.light'), icon: <Sun aria-hidden="true" /> },
  { value: 'dark', label: () => t('account.appearance.dark'), icon: <Moon aria-hidden="true" /> },
  {
    value: 'system',
    label: () => t('account.appearance.system'),
    icon: <Monitor aria-hidden="true" />,
  },
];

export default function Account() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const theme = useSignal(themePreference);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const accounts = useResource(() => authClient.listAccounts(), []);
  const hasCredentialAccount = (accounts.data?.data ?? []).some(
    (a) => a.providerId === 'credential',
  );

  const user = session.data?.user;
  const userName = user?.name ?? '';
  const userEmail = user?.email ?? '';
  const userId = user?.id ?? '';
  const currentLocale = useLocale();

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');

    if (newPassword !== confirmPassword) {
      setPwError(t('account.security.mismatch'));
      return;
    }
    if (newPassword.length < 8) {
      setPwError(t('account.security.tooShort'));
      return;
    }
    if (newPassword === currentPassword) {
      setPwError(t('account.security.sameAsCurrent'));
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
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

  return (
    <div className="page narrow">
      <title>{t('common.pageTitle', { page: t('account.title') })}</title>
      <meta name="description" content={t('account.metaDescription')} />
      <Button variant="quiet" size="sm" className="mb-3" onClick={() => navigate(-1)}>
        <ChevronLeft aria-hidden="true" />
        {t('common.back')}
      </Button>
      <div className="page-head">
        <div>
          <h1>{t('account.title')}</h1>
          <div className="sub">{t('account.subtitle')}</div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title={t('account.profile.title')}>
          <div className="flex flex-col gap-4">
            <Field
              label={t('account.profile.displayName')}
              hint={t('account.profile.displayNameDesc')}
              htmlFor="account-name"
            >
              <input id="account-name" className="field" type="text" value={userName} readOnly />
            </Field>
            <Field
              label={t('account.profile.email')}
              hint={t('account.profile.emailDesc')}
              htmlFor="account-email"
            >
              <input id="account-email" className="field" type="email" value={userEmail} readOnly />
            </Field>
            <p className="text-xs text-faint">{t('account.profile.managedBy')}</p>
          </div>
        </Panel>

        {hasCredentialAccount ? (
          <Panel title={t('account.security.title')}>
            <form className="flex flex-col gap-4" onSubmit={handleChangePassword}>
              <Field
                label={t('account.security.currentPassword')}
                hint={t('account.security.currentPasswordDesc')}
                htmlFor="account-current-password"
              >
                <input
                  id="account-current-password"
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </Field>
              <Field
                label={t('account.security.newPassword')}
                hint={t('account.security.newPasswordDesc')}
                htmlFor="account-new-password"
              >
                <input
                  id="account-new-password"
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </Field>
              <Field
                label={t('account.security.confirmPassword')}
                hint={t('account.security.confirmPasswordDesc')}
                htmlFor="account-confirm-password"
              >
                <input
                  id="account-confirm-password"
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="mr-auto text-sm text-danger" role="alert">
                  {pwError}
                </span>
                <Button type="submit" size="sm" busy={pwBusy}>
                  {t('account.security.submit')}
                </Button>
              </div>
            </form>
          </Panel>
        ) : null}

        <Panel title={t('account.workspace.title')}>
          <p className="mb-3 text-sm text-dim">{t('account.workspace.desc')}</p>
          <div className="well flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{userId}</code>
            <CopyButton text={userId} />
          </div>
        </Panel>

        <Panel title={t('account.appearance.title')}>
          <p className="mb-3 text-sm text-dim">{t('account.appearance.desc')}</p>
          <div className="segmented" role="group" aria-label={t('account.appearance.title')}>
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                className="inline-flex items-center gap-1.5 [&>svg]:size-[15px]"
                aria-pressed={theme === option.value}
                onClick={() => setThemePreference(option.value)}
              >
                {option.icon}
                {option.label()}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={t('account.language.title')}>
          <p className="mb-3 text-sm text-dim">{t('account.language.desc')}</p>
          <div className="segmented" role="group" aria-label={t('account.language.label')}>
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={currentLocale === l}
                lang={l}
                onClick={() => setLocale(l)}
              >
                {LOCALE_NAMES[l]}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
