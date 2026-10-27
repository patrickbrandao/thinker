import type { JSX } from 'solid-js';
import { t } from '../i18n/index.js';

interface PipelineStep {
  num: number;
  name: JSX.Element;
  desc: string;
}

/**
 * Builds the pipeline help modal content.
 */
export function buildPipelineHelp(
  specificity: boolean,
  custom: boolean,
  complexity: boolean,
): JSX.Element {
  const steps: PipelineStep[] = [];
  let n = 1;

  if (custom) {
    steps.push({
      num: n++,
      name: t('routing.pipeline.customName'),
      desc: t('routing.pipeline.customDesc'),
    });
  }

  if (specificity) {
    steps.push({
      num: n++,
      name: t('routing.pipeline.specificityName'),
      desc: t('routing.pipeline.specificityDesc'),
    });
  }

  steps.push({
    num: n,
    name: complexity ? (
      <>
        {t('routing.pipeline.defaultName')} <i>{t('routing.pipeline.complexity')}</i>
      </>
    ) : (
      <>
        {t('routing.pipeline.defaultName')} <i>{t('routing.pipeline.regular')}</i>
      </>
    ),
    desc: complexity ? t('routing.pipeline.complexityDesc') : t('routing.pipeline.regularDesc'),
  });

  return (
    <div class="routing-pipeline-help-steps">
      <p class="routing-pipeline-help-summary">{t('routing.pipeline.summary')}</p>
      <p class="routing-pipeline-help-summary">{t('routing.pipeline.current')}</p>
      {steps.map((step) => (
        <div class="routing-pipeline-help-step">
          <span class="routing-pipeline-help-step__head">
            <span class="routing-pipeline-help-step__num">{step.num}</span>
            <span class="routing-pipeline-help-step__tag">{step.name}</span>
          </span>
          <span class="routing-pipeline-help-step__desc">{step.desc}</span>
        </div>
      ))}
    </div>
  );
}
