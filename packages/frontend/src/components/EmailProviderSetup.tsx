import { createSignal, type Component } from 'solid-js';
import EmailProviderModal from './EmailProviderModal.jsx';
import { t } from '../i18n/index.js';

interface Props {
  onConfigured: () => void;
}

const EmailProviderSetup: Component<Props> = (props) => {
  const [modalOpen, setModalOpen] = createSignal(false);
  const [selectedProvider, setSelectedProvider] = createSignal<string>('resend');

  const openModal = (provider: string) => {
    setSelectedProvider(provider);
    setModalOpen(true);
  };

  return (
    <>
      <h3 class="provider-setup__title">{t('harnesses.email.configureTitle')}</h3>
      <p class="provider-setup__subtitle">{t('harnesses.email.setupSubtitle')}</p>

      <div class="provider-setup-grid">
        <button class="provider-setup-card" onClick={() => openModal('resend')}>
          <img src="/logos/resend.svg" alt="" class="provider-setup-card__logo" />
          <div>
            <div class="provider-setup-card__name">Resend</div>
            <div class="provider-setup-card__desc">{t('harnesses.email.resendDesc')}</div>
          </div>
        </button>
        <button class="provider-setup-card" onClick={() => openModal('mailgun')}>
          <img src="/logos/mailgun.svg" alt="" class="provider-setup-card__logo" />
          <div>
            <div class="provider-setup-card__name">Mailgun</div>
            <div class="provider-setup-card__desc">{t('harnesses.email.mailgunDesc')}</div>
          </div>
        </button>
        <button class="provider-setup-card" onClick={() => openModal('sendgrid')}>
          <img src="/logos/sendgrid.svg" alt="" class="provider-setup-card__logo" />
          <div>
            <div class="provider-setup-card__name">SendGrid</div>
            <div class="provider-setup-card__desc">{t('harnesses.email.sendgridDesc')}</div>
          </div>
        </button>
      </div>

      <EmailProviderModal
        open={modalOpen()}
        initialProvider={selectedProvider()}
        onClose={() => setModalOpen(false)}
        onSaved={props.onConfigured}
      />
    </>
  );
};

export default EmailProviderSetup;
