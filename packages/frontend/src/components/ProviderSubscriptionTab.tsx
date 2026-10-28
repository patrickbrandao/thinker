import { BookOpen } from 'lucide-react';
import type { AuthType } from '../services/api.js';
import type { ProviderDef } from '../services/providers.js';
import { providerIcon } from './ProviderIcon.js';
import { THINKER_PROVIDERS_DOCS_URL } from '../services/thinker-links.js';
import { t } from '../i18n/index.js';
import { LetterBadge, RowAddAction, ToggleSwitch, toggleRowClass } from './ProviderApiKeyTab.js';

interface Props {
  subscriptionProviders: ProviderDef[];
  busy: boolean;
  isSubscriptionConnected: (provId: string) => boolean;
  isSubscriptionWithToken: (provId: string) => boolean;
  onOpenDetail: (provId: string, authType: AuthType) => void;
  onAddKey: (provId: string, authType: AuthType) => void;
  onToggle: (provId: string) => void;
}

const getSubscriptionAuthMode = (prov: ProviderDef) =>
  prov.subscriptionAuthMode ?? (prov.subscriptionKeyPlaceholder ? 'token' : undefined);

export default function ProviderSubscriptionTab(props: Props) {
  return (
    <>
      <p className="provider-modal__tab-hint mb-3 text-sm text-muted">
        {t('providerSetup.tabs.subscriptionHint')}
      </p>
      <div className="provider-modal__list flex flex-col gap-1.5">
        {props.subscriptionProviders.map((prov) => {
          const hasDetailView =
            !!prov.subscriptionKeyPlaceholder ||
            !!prov.subscriptionCommand ||
            !!getSubscriptionAuthMode(prov);
          const requiresStoredToken = getSubscriptionAuthMode(prov) === 'token';
          const connected = requiresStoredToken
            ? props.isSubscriptionWithToken(prov.id)
            : props.isSubscriptionConnected(prov.id);

          return (
            <button
              key={prov.id}
              type="button"
              className={toggleRowClass}
              disabled={props.busy}
              onClick={() =>
                hasDetailView
                  ? props.onOpenDetail(prov.id, 'subscription')
                  : props.onToggle(prov.id)
              }
            >
              <span className="provider-toggle__icon inline-flex size-5 shrink-0 items-center justify-center">
                {providerIcon(prov.id, 20) ?? (
                  <LetterBadge color={prov.color}>{prov.initial}</LetterBadge>
                )}
              </span>
              <span className="provider-toggle__info flex min-w-0 flex-1 flex-col">
                <span className="provider-toggle__name truncate text-sm font-medium text-ink">
                  {prov.name}
                </span>
                <span className="provider-toggle__local-only truncate text-xs text-faint">
                  {prov.subscriptionLabel ?? t('providerSetup.tabs.subscription')}
                </span>
              </span>
              <span className="provider-toggle__actions flex shrink-0 items-center gap-2">
                {connected ? (
                  <RowAddAction
                    label={t('providerSetup.tabs.addConnectionFor', { name: prov.name })}
                    tooltip={t('providerSetup.shared.addConnection')}
                    onActivate={() => props.onAddKey(prov.id, 'subscription')}
                  />
                ) : null}
                <ToggleSwitch on={connected} />
              </span>
            </button>
          );
        })}
        <div className="provider-modal__add-custom pt-2">
          <a
            className="provider-modal__add-custom-chip btn btn-ghost btn-sm"
            href={THINKER_PROVIDERS_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpen aria-hidden="true" />
            {t('providerSetup.tabs.subscriptionGuide')}
          </a>
        </div>
      </div>
    </>
  );
}
