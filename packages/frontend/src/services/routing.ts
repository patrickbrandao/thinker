import { useLocation } from '@solidjs/router';
import { t, tMaybe } from '../i18n/index.js';
import type { StageDef } from './providers.js';

export function useAgentName(): () => string | null {
  const location = useLocation();
  return () => {
    const match = location.pathname.match(/^\/harnesses\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  };
}

/** Translated label of a routing stage (falls back to the English definition). */
export function stageLabel(stage: StageDef): string {
  return tMaybe(`routing.stages.${stage.id}.label`) ?? stage.label;
}

/** Translated one-line description of a routing stage. */
export function stageDesc(stage: StageDef): string {
  return tMaybe(`routing.stages.${stage.id}.desc`) ?? stage.desc;
}

/** Translated label for an internal `Primary` / `Fallback N` route position. */
export function positionLabel(position: string): string {
  if (position === 'Primary') return t('routing.responseMode.primary');
  const n = Number(position.replace('Fallback ', ''));
  return t('routing.responseMode.fallbackN', { n });
}

export function agentPath(agentName: string | null, sub: string): string {
  return agentName ? `/harnesses/${encodeURIComponent(agentName)}${sub}` : '/';
}
