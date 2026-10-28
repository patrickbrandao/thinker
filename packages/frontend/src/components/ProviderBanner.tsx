import { Mail, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import type { EmailProviderConfig } from '../services/api.js';
import { t } from '../i18n/index.js';
import { Menu, MenuItem } from './ui.js';

const PROVIDER_LOGOS: Record<string, string> = {
  resend: '/logos/resend.svg',
  mailgun: '/logos/mailgun.svg',
  sendgrid: '/logos/sendgrid.svg',
};

const PROVIDER_NAMES: Record<string, string> = {
  resend: 'Resend',
  mailgun: 'Mailgun',
  sendgrid: 'SendGrid',
};

interface Props {
  config: EmailProviderConfig;
  onEdit: () => void;
  onRemove: () => void;
}

/** The configured email provider: logo, key prefix, domain and an Edit/Remove menu. */
export default function ProviderBanner(props: Props) {
  const logo = PROVIDER_LOGOS[props.config.provider] ?? '/logos/resend.svg';
  const name = PROVIDER_NAMES[props.config.provider] ?? props.config.provider;

  return (
    <div className="provider-card card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{t('providers.banner.yourProvider')}</span>
        <Menu
          align="right"
          trigger={(triggerProps) => (
            <button
              type="button"
              className="provider-card__menu-btn icon-btn"
              aria-label={t('providers.banner.options')}
              {...triggerProps}
            >
              <MoreVertical aria-hidden="true" />
            </button>
          )}
        >
          <MenuItem icon={<Pencil aria-hidden="true" />} onSelect={props.onEdit}>
            {t('providers.banner.edit')}
          </MenuItem>
          <MenuItem icon={<Trash2 aria-hidden="true" />} danger onSelect={props.onRemove}>
            {t('providers.banner.remove')}
          </MenuItem>
        </Menu>
      </div>
      <div className="flex items-center gap-3">
        <img src={logo} alt="" className="provider-card__logo size-8 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{name}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {props.config.domain ? <span>{props.config.domain}</span> : null}
            <span className="font-mono">{props.config.keyPrefix}...</span>
            {props.config.notificationEmail ? (
              <span className="provider-card__email inline-flex items-center gap-1">
                <Mail aria-hidden="true" className="size-3" />
                {props.config.notificationEmail}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
