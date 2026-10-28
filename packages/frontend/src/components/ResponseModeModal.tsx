import type {
  AvailableModel,
  ModelCapability,
  ResponseMode,
  TierAssignment,
} from '../services/api.js';
import { STAGES, DEFAULT_STAGE } from '../services/providers.js';
import { positionLabel, stageLabel } from '../services/routing.js';
import { Button, Modal } from './ui.js';
import { t } from '../i18n/index.js';

export interface IncompatibleModel {
  model: string;
  tier: string;
  tierLabel: string;
  position: string;
}

interface Props {
  responseMode: ResponseMode;
  onResponseModeChange: (mode: ResponseMode) => void | Promise<void>;
  disabled?: boolean;
  tiers: TierAssignment[];
  models: AvailableModel[];
  onClose: () => void;
  onReplace?: (
    tierId: string,
    position: 'primary' | number,
    requiredCapability: ModelCapability,
  ) => void;
}

function tierLabel(tierId: string): string {
  const stage = [DEFAULT_STAGE, ...STAGES].find((s) => s.id === tierId);
  return stage ? stageLabel(stage) : tierId;
}

function getIncompatibleModels(
  tiers: TierAssignment[],
  models: AvailableModel[],
): IncompatibleModel[] {
  const caps = new Map<string, readonly ModelCapability[]>();
  for (const m of models) {
    if (m.capabilities) caps.set(m.model_name, m.capabilities);
  }
  const hasStream = (model: string) => caps.get(model)?.includes('stream') ?? false;

  const result: IncompatibleModel[] = [];
  for (const tier of tiers) {
    const route = tier.override_route;
    if (route && !hasStream(route.model)) {
      result.push({
        model: route.model,
        tier: tier.tier,
        tierLabel: tierLabel(tier.tier),
        position: 'Primary',
      });
    }
    for (const [i, fb] of (tier.fallback_routes ?? []).entries()) {
      if (!hasStream(fb.model)) {
        result.push({
          model: fb.model,
          tier: tier.tier,
          tierLabel: tierLabel(tier.tier),
          position: `Fallback ${i + 1}`,
        });
      }
    }
  }
  return result;
}

/**
 * Stream / buffered switch for the default tier, blocked while any routed
 * model lacks streaming. `response-mode-modal*` classes are stable test hooks.
 */
export default function ResponseModeModal(props: Props) {
  const isStream = props.responseMode === 'stream';
  const incompatible = getIncompatibleModels(props.tiers, props.models);
  const canEnableStream = incompatible.length === 0;
  const blocked = !isStream && !canEnableStream;

  const handleToggle = () => {
    if (isStream) {
      void props.onResponseModeChange('buffered');
    } else if (canEnableStream) {
      void props.onResponseModeChange('stream');
    }
  };

  return (
    <Modal open title={t('routing.responseMode.title')} onClose={props.onClose}>
      <div className="response-mode-modal flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink">
            {t('routing.responseMode.streamMode')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isStream}
            aria-label={t('routing.responseMode.streamMode')}
            className="switch response-mode-modal__switch"
            disabled={props.disabled || blocked}
            onClick={handleToggle}
          />
        </div>
        <p className="text-sm text-dim">
          {isStream
            ? t('routing.responseMode.streamDescOnly')
            : t('routing.responseMode.bufferedDescAll')}
        </p>

        {!isStream && incompatible.length > 0 ? (
          <div className="response-mode-modal__blocker notice is-warn flex flex-col gap-2">
            <p className="text-sm">{t('routing.responseMode.unavailable', incompatible.length)}</p>
            <div className="flex flex-col divide-y divide-line rounded-control border border-line bg-elev">
              {incompatible.map((item) => (
                <div
                  key={`${item.tier}-${item.position}-${item.model}`}
                  className="response-mode-modal__blocker-row flex items-center gap-3 px-3 py-2"
                >
                  <span className="response-mode-modal__blocker-model min-w-0 flex-1 truncate font-mono text-sm text-ink">
                    {item.model}
                  </span>
                  <span className="response-mode-modal__blocker-meta shrink-0 text-xs text-muted">
                    {item.tierLabel} · {positionLabel(item.position)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="response-mode-modal__change"
                    onClick={() =>
                      props.onReplace?.(
                        item.tier,
                        item.position === 'Primary'
                          ? 'primary'
                          : parseInt(item.position.replace('Fallback ', '')) - 1,
                        'stream',
                      )
                    }
                  >
                    {t('routing.change')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
