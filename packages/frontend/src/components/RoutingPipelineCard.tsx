import type { ReactNode } from 'react';
import { t } from '../i18n/index.js';

interface PipelineStep {
  num: number;
  name: ReactNode;
  desc: string;
}

/**
 * Builds the pipeline help modal content.
 */
export function buildPipelineHelp(
  specificity: boolean,
  custom: boolean,
  complexity: boolean,
): ReactNode {
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
    name: (
      <>
        {t('routing.pipeline.defaultName')}{' '}
        <i>{complexity ? t('routing.pipeline.complexity') : t('routing.pipeline.regular')}</i>
      </>
    ),
    desc: complexity ? t('routing.pipeline.complexityDesc') : t('routing.pipeline.regularDesc'),
  });

  return (
    <div className="routing-pipeline-help-steps flex flex-col gap-3 text-sm text-dim">
      <p>{t('routing.pipeline.summary')}</p>
      <p>{t('routing.pipeline.current')}</p>
      {steps.map((step) => (
        <div key={step.num} className="flex flex-col gap-1 rounded-control border border-line p-3">
          <span className="flex items-center gap-2">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-xs font-semibold text-accent">
              {step.num}
            </span>
            <span className="font-medium text-ink">{step.name}</span>
          </span>
          <span className="text-muted">{step.desc}</span>
        </div>
      ))}
    </div>
  );
}
