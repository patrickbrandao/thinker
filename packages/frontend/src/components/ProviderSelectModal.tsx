import { type CustomProviderData, type RoutingProvider } from '../services/api.js';
import type { CustomProviderPrefill, ProviderDeepLink } from '../services/routing-params.js';
import { t } from '../i18n/index.js';
import { Modal } from './ui.js';
import ProviderSelectContent from './ProviderSelectContent.js';

interface Props {
  agentName: string;
  providers: RoutingProvider[];
  customProviders?: CustomProviderData[];
  customProviderPrefill?: CustomProviderPrefill | null;
  providerDeepLink?: ProviderDeepLink | null;
  initialTab?: 'subscription' | 'api_key' | 'local';
  onClose: () => void;
  onUpdate: () => void | Promise<void>;
  onPollProviders?: () => void | Promise<void>;
  /** Re-authenticating this subscription connection (by label) instead of adding one. */
  reauthLabel?: string;
}

/** The provider connect flow in a modal; the content renders its own header. */
export default function ProviderSelectModal(props: Props) {
  return (
    <Modal open wide onClose={props.onClose} label={t('providerSetup.shared.connectProvider')}>
      <ProviderSelectContent
        agentName={props.agentName}
        providers={props.providers}
        customProviders={props.customProviders}
        customProviderPrefill={props.customProviderPrefill}
        providerDeepLink={props.providerDeepLink}
        initialTab={props.initialTab}
        onUpdate={props.onUpdate}
        onPollProviders={props.onPollProviders}
        onClose={props.onClose}
        reauthLabel={props.reauthLabel}
      />
    </Modal>
  );
}
