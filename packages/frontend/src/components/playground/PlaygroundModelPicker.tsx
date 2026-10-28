import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  RoutingProvider,
} from '../../services/api.js';
import ModelPickerModal from '../ModelPickerModal.jsx';

interface Props {
  /** Unique-per-column id so we know which column the selection is for. */
  columnId: string;
  models: AvailableModel[];
  customProviders?: CustomProviderData[];
  connectedProviders?: RoutingProvider[];
  onSelect: (columnId: string, model: string, provider: string, authType?: AuthType) => void;
  onClose: () => void;
}

/**
 * Thin wrapper around `ModelPickerModal` for the Playground page. Hides the
 * `tierId` convention (the underlying modal was designed for routing tiers) so
 * callers work with a clean `(model, provider, authType)` callback.
 */
export default function PlaygroundModelPicker({
  columnId,
  models,
  customProviders,
  connectedProviders,
  onSelect,
  onClose,
}: Props) {
  return (
    <ModelPickerModal
      tierId={`playground:${columnId}`}
      models={models}
      tiers={[]}
      customProviders={customProviders}
      connectedProviders={connectedProviders}
      onSelect={(_tierId: string, model: string, provider: string, authType?: AuthType) =>
        onSelect(columnId, model, provider, authType)
      }
      onClose={onClose}
    />
  );
}
