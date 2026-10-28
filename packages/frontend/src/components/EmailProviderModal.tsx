import { useEffect, useState, type CSSProperties } from 'react';
import { setEmailProvider, testEmailProvider, testSavedEmailProvider } from '../services/api.js';
import { authClient } from '../services/auth-client.js';
import { getEmailProviderApiKeyUrl } from '../services/provider-api-key-urls.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { Button, Modal, cx } from './ui.js';

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const PROVIDER_NAMES: Record<string, string> = {
  resend: 'Resend',
  mailgun: 'Mailgun',
  sendgrid: 'SendGrid',
};

const PROVIDER_ORDER = ['resend', 'mailgun', 'sendgrid'] as const;

/** Masks the key like a password field while keeping autocomplete off. */
const MASKED_INPUT_STYLE = { WebkitTextSecurity: 'disc', textSecurity: 'disc' } as CSSProperties;

interface Props {
  open: boolean;
  initialProvider: string;
  editMode?: boolean;
  existingKeyPrefix?: string | null;
  existingDomain?: string | null;
  existingNotificationEmail?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function EmailProviderModal(props: Props) {
  const {
    open,
    initialProvider,
    editMode,
    existingKeyPrefix,
    existingDomain,
    existingNotificationEmail,
    onClose,
    onSaved,
  } = props;
  const session = authClient.useSession();
  const sessionEmail = session.data?.user?.email ?? null;

  const [provider, setProvider] = useState(initialProvider);
  const [apiKey, setApiKey] = useState('');
  const [domain, setDomain] = useState(existingDomain ?? '');
  const [notificationEmail, setNotificationEmail] = useState(
    existingNotificationEmail ?? sessionEmail ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [domainError, setDomainError] = useState('');
  const [editingKey, setEditingKey] = useState(!(editMode && !!existingKeyPrefix));

  // Opening the modal (or new saved values arriving while open) resets the form.
  useEffect(() => {
    if (!open) return;
    setProvider(initialProvider);
    setApiKey('');
    setEditingKey(!(editMode && !!existingKeyPrefix));
    setDomain(existingDomain ?? '');
    setNotificationEmail(existingNotificationEmail ?? sessionEmail ?? '');
    setKeyError('');
    setDomainError('');
  }, [
    open,
    initialProvider,
    editMode,
    existingKeyPrefix,
    existingDomain,
    existingNotificationEmail,
    sessionEmail,
  ]);

  const hasExistingKey = !!editMode && !!existingKeyPrefix && provider === initialProvider;
  const keepingExistingKey = !editingKey && hasExistingKey;
  const maskedKey = (existingKeyPrefix ?? '') + '••••••••';
  const needsDomain = provider === 'mailgun';
  const busy = saving || testing;

  const validateFields = (): boolean => {
    let valid = true;
    const key = apiKey.trim();
    const dom = domain.trim().toLowerCase();

    // Skip API key validation when keeping the existing key
    if (keepingExistingKey) {
      setKeyError('');
    } else if (!key) {
      setKeyError(t('harnesses.email.keyRequired'));
      valid = false;
    } else if (key.length < 8) {
      setKeyError(t('harnesses.email.keyTooShort'));
      valid = false;
    } else if (provider === 'resend' && !key.startsWith('re_')) {
      setKeyError(t('harnesses.email.resendPrefix'));
      valid = false;
    } else if (provider === 'sendgrid' && !key.startsWith('SG.')) {
      setKeyError(t('harnesses.email.sendgridPrefix'));
      valid = false;
    } else {
      setKeyError('');
    }

    if (needsDomain && !dom) {
      setDomainError(t('harnesses.email.domainRequired'));
      valid = false;
    } else if (dom && !DOMAIN_RE.test(dom)) {
      setDomainError(t('harnesses.email.domainInvalid'));
      valid = false;
    } else {
      setDomainError('');
    }

    return valid;
  };

  const getTestRecipient = () => notificationEmail.trim() || sessionEmail;

  const runTest = async (): Promise<boolean> => {
    const recipient = getTestRecipient();
    if (!recipient) {
      toast.error(t('harnesses.email.needRecipient'));
      return false;
    }
    setTesting(true);
    try {
      const trimmedDomain = domain.trim().toLowerCase();
      const testData: { provider: string; apiKey: string; domain?: string; to: string } = {
        provider,
        apiKey: apiKey.trim(),
        to: recipient,
      };
      if (trimmedDomain) testData.domain = trimmedDomain;
      const result = await testEmailProvider(testData);
      if (!result.success) {
        toast.error(result.error ?? t('harnesses.email.testFailed'));
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      setTesting(false);
    }
  };

  const runTestSaved = async (): Promise<boolean> => {
    const recipient = getTestRecipient();
    if (!recipient) {
      toast.error(t('harnesses.email.needRecipient'));
      return false;
    }
    setTesting(true);
    try {
      const result = await testSavedEmailProvider(recipient);
      if (!result.success) {
        toast.error(result.error ?? t('harnesses.email.testFailed'));
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      setTesting(false);
    }
  };

  const handleTestOnly = async () => {
    if (!validateFields()) return;
    if (busy) return;
    const ok = keepingExistingKey ? await runTestSaved() : await runTest();
    if (ok) toast.success(t('harnesses.email.testSent', { to: getTestRecipient() ?? '' }));
  };

  const handleSave = async () => {
    if (!validateFields()) return;
    if (busy) return;

    const ok = keepingExistingKey ? await runTestSaved() : await runTest();
    if (!ok) return;

    setSaving(true);
    try {
      const saveData: {
        provider: string;
        apiKey?: string;
        domain?: string;
        notificationEmail?: string;
      } = { provider };
      if (!keepingExistingKey) saveData.apiKey = apiKey.trim();
      const trimmedDomain = domain.trim().toLowerCase();
      if (trimmedDomain) saveData.domain = trimmedDomain;
      const trimmedEmail = notificationEmail.trim();
      if (trimmedEmail) saveData.notificationEmail = trimmedEmail;
      await setEmailProvider(saveData);
      toast.success(
        t('harnesses.email.connected', { provider: PROVIDER_NAMES[provider] ?? provider }),
      );
      onSaved();
      onClose();
    } catch {
      // error toast from fetchMutate
    } finally {
      setSaving(false);
    }
  };

  const isDisabled = keepingExistingKey
    ? needsDomain && !domain.trim()
    : !apiKey.trim() || (needsDomain && !domain.trim());

  const buttonLabel = testing
    ? t('harnesses.email.testing')
    : saving
      ? t('common.saving')
      : editMode
        ? t('harnesses.email.testAndSave')
        : t('harnesses.email.testAndConnect');

  const keyDocsUrl = getEmailProviderApiKeyUrl(provider);
  const keyPlaceholder =
    provider === 'resend' ? 're_xxxx...' : provider === 'sendgrid' ? 'SG.xxxx...' : 'key-xxxx...';

  return (
    <Modal
      open={open}
      title={editMode ? t('harnesses.email.editTitle') : t('harnesses.email.configureTitle')}
      onClose={onClose}
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            void handleSave();
          }
        }}
      >
        <p className="mb-4 text-sm text-muted">{t('harnesses.email.modalDesc')}</p>

        <span className="label">{t('harnesses.email.provider')}</span>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {PROVIDER_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={provider === id}
              className={cx(
                'provider-modal-option flex items-center justify-center gap-2 rounded-control border px-2 py-2 text-sm',
                provider === id
                  ? 'is-active border-accent bg-accent-tint text-ink'
                  : 'border-line bg-elev text-dim hover:bg-s2',
              )}
              onClick={() => {
                setProvider(id);
                setKeyError('');
              }}
            >
              <img src={`/logos/${id}.svg`} alt="" className="size-4" />
              <span>{PROVIDER_NAMES[id]}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-4">
          <div>
            <label className="label" htmlFor="email-provider-api-key">
              {t('harnesses.email.apiKey')}
            </label>
            {editingKey || !hasExistingKey ? (
              <input
                id="email-provider-api-key"
                className="field"
                aria-invalid={keyError ? true : undefined}
                type="text"
                autoComplete="off"
                autoFocus
                style={MASKED_INPUT_STYLE}
                placeholder={keyPlaceholder}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.currentTarget.value);
                  setKeyError('');
                }}
              />
            ) : (
              <div className="masked-key field flex items-center justify-between gap-2">
                <span className="truncate font-mono text-dim">{maskedKey}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingKey(true);
                    setApiKey('');
                  }}
                >
                  {t('harnesses.email.change')}
                </Button>
              </div>
            )}
            {keyError ? (
              <p className="form-error mt-1" role="alert">
                {keyError}
              </p>
            ) : null}
            {keyDocsUrl ? (
              <p className="hint">
                <a
                  className="link-action"
                  href={keyDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('harnesses.email.getKey', { provider: PROVIDER_NAMES[provider] ?? provider })}
                </a>
              </p>
            ) : null}
          </div>

          {needsDomain ? (
            <div>
              <label className="label" htmlFor="email-provider-domain">
                {t('harnesses.email.domain')}
              </label>
              <input
                id="email-provider-domain"
                className="field"
                aria-invalid={domainError ? true : undefined}
                type="text"
                placeholder={t('harnesses.email.domainPlaceholder')}
                value={domain}
                onChange={(e) => {
                  setDomain(e.currentTarget.value);
                  setDomainError('');
                }}
              />
              {domainError ? (
                <p className="form-error mt-1" role="alert">
                  {domainError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="email-provider-notification">
              {t('harnesses.email.notificationEmail')}
            </label>
            <input
              id="email-provider-notification"
              className="field"
              type="email"
              placeholder={sessionEmail ?? t('harnesses.email.notificationPlaceholder')}
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.currentTarget.value)}
            />
            <p className="hint">{t('harnesses.email.notificationHint')}</p>
          </div>
        </div>

        <div className="actions justify-between">
          <Button
            variant="ghost"
            size="sm"
            busy={testing}
            disabled={busy || isDisabled}
            onClick={() => void handleTestOnly()}
          >
            {t('harnesses.email.sendTest')}
          </Button>
          <Button size="sm" disabled={busy || isDisabled} onClick={() => void handleSave()}>
            {buttonLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
