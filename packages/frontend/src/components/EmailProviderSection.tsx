import ProviderBanner from './ProviderBanner.js';
import EmailProviderSetup from './EmailProviderSetup.js';
import type { EmailProviderConfig } from '../services/api.js';
import { t } from '../i18n/index.js';
import { Skel } from './ui.js';

interface EmailProviderSectionProps {
  emailProvider: EmailProviderConfig | null | undefined;
  loading: boolean;
  onConfigured: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

/**
 * The email sender block of the Limits page: the provider banner when one is
 * saved, the setup picker otherwise, and a matching skeleton while loading.
 */
export default function EmailProviderSection({
  emailProvider,
  loading,
  onConfigured,
  onEdit,
  onRemove,
}: EmailProviderSectionProps) {
  if (loading) {
    if (emailProvider) {
      return (
        <div className="provider-card card mb-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="provider-card__label text-xs font-medium text-muted">
              {t('harnesses.email.yourProvider')}
            </span>
            <Skel width={16} height={16} />
          </div>
          <div className="flex items-center gap-3">
            <Skel width={36} height={36} />
            <div className="flex flex-col gap-1">
              <Skel width={80} height={14} />
              <Skel width={160} height={12} />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="mb-4">
        <Skel width={180} height={16} />
        <div className="mb-3 mt-2">
          <Skel width={280} height={13} />
        </div>
        <div className="provider-setup-grid grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card flex items-center gap-3">
              <span className="skel-rect inline-flex">
                <Skel width={32} height={32} />
              </span>
              <div className="flex flex-col gap-1">
                <Skel width={64} height={13} />
                <Skel width={88} height={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!emailProvider) {
    return (
      <div className="mb-4">
        <EmailProviderSetup onConfigured={onConfigured} />
      </div>
    );
  }

  return (
    <div className="mb-4">
      <ProviderBanner config={emailProvider} onEdit={onEdit} onRemove={onRemove} />
    </div>
  );
}
