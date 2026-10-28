import { useState } from 'react';
import EmailProviderModal from './EmailProviderModal.js';
import { t } from '../i18n/index.js';

interface Props {
  onConfigured: () => void;
}

const CARDS = [
  { id: 'resend', name: 'Resend', desc: () => t('harnesses.email.resendDesc') },
  { id: 'mailgun', name: 'Mailgun', desc: () => t('harnesses.email.mailgunDesc') },
  { id: 'sendgrid', name: 'SendGrid', desc: () => t('harnesses.email.sendgridDesc') },
] as const;

/** First-run picker: one card per email service, each opening the config modal. */
export default function EmailProviderSetup({ onConfigured }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('resend');

  return (
    <>
      <h3 className="text-sm font-semibold text-ink">{t('harnesses.email.configureTitle')}</h3>
      <p className="mb-3 mt-1 text-sm text-muted">{t('harnesses.email.setupSubtitle')}</p>

      <div className="provider-setup-grid grid gap-3 sm:grid-cols-3">
        {CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="provider-setup-card card flex items-center gap-3 text-left hover:border-line-strong"
            onClick={() => {
              setSelectedProvider(card.id);
              setModalOpen(true);
            }}
          >
            <img
              src={`/logos/${card.id}.svg`}
              alt=""
              className="provider-setup-card__logo size-8 shrink-0"
            />
            <div>
              <div className="text-sm font-medium text-ink">{card.name}</div>
              <div className="text-xs text-muted">{card.desc()}</div>
            </div>
          </button>
        ))}
      </div>

      <EmailProviderModal
        open={modalOpen}
        initialProvider={selectedProvider}
        onClose={() => setModalOpen(false)}
        onSaved={onConfigured}
      />
    </>
  );
}
