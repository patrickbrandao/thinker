import { CATEGORY_LABELS, PLATFORM_LABELS } from 'thinker-shared';
import { tMaybe } from '../i18n/index.js';

/** Localized harness category label (AI agent, Automation...). */
export function categoryLabel(cat: string): string {
  return (
    tMaybe(`harnesses.category.${cat}`) ??
    CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ??
    cat
  );
}

/** Platform label: product names stay as they are, only "Other" is translated. */
export function platformLabel(plat: string): string {
  if (plat === 'other') return tMaybe('harnesses.platformOther') ?? 'Other';
  return PLATFORM_LABELS[plat as keyof typeof PLATFORM_LABELS] ?? plat;
}
