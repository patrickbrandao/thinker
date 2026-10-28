import { lazy, Suspense, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ProviderParamSpec } from 'thinker-shared';
import type { AuthType, RequestParamDefaults } from '../services/api.js';
import { getModelParamSpecs } from '../services/api/model-params.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

// Only mounted while the parameters dialog is open. Lazy-load it so the
// Routing route doesn't ship the dialog up front.
const ModelParamsDialog = lazy(() => import('./ModelParamsDialog.jsx'));

const NO_SPECS: ProviderParamSpec[] = [];

interface Props {
  agentName: string;
  provider: string | undefined;
  authType: AuthType | undefined;
  model: string;
  slotLabel: string;
  scope: string;
  getParams: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ) => RequestParamDefaults | null;
  setParams: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    params: RequestParamDefaults | null,
  ) => Promise<unknown>;
  disabled?: boolean;
}

export default function ModelParamsAffordance(props: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { provider, authType, model, agentName } = props;

  // Fetch specs only while the dialog is open, so the Routing page never
  // downloads the whole catalog up front. The provider/model filtering that
  // used to run client-side now happens server-side via the by-model endpoint.
  const specs = useResource(
    () =>
      getModelParamSpecs(agentName, provider!, authType!, model).catch(
        () => [] as ProviderParamSpec[],
      ),
    [agentName, provider, authType, model],
    { enabled: dialogOpen && !!provider && !!authType },
  );

  const canOpen = provider !== undefined && authType !== undefined && authType !== 'local';
  if (!canOpen) return null;

  const current =
    provider && authType ? props.getParams(props.scope, provider, authType, model) : null;
  const configured = current !== null;

  return (
    <>
      <button
        type="button"
        className={cx(
          'routing-card__chip-action icon-btn size-6',
          configured && 'routing-card__chip-action--configured text-accent',
          dialogOpen && 'routing-card__chip-action--dialog-open',
        )}
        onClick={(e) => {
          e.stopPropagation();
          setDialogOpen(true);
        }}
        disabled={props.disabled}
        aria-label={t('models.paramsAffordance.configureFor', { slot: props.slotLabel })}
        title={t('models.paramsAffordance.parameters')}
      >
        <SlidersHorizontal aria-hidden="true" className="size-3" />
      </button>
      {dialogOpen && provider && authType ? (
        <Suspense fallback={null}>
          <ModelParamsDialog
            open={dialogOpen}
            slotLabel={props.slotLabel}
            current={current}
            specs={specs.data ?? NO_SPECS}
            loading={specs.loading || specs.data === undefined}
            onSave={(next) => props.setParams(props.scope, provider, authType, model, next)}
            onClose={() => setDialogOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
