import { t } from '../i18n/index.js';
import { signal } from '../lib/signal.js';

/** A label, or a getter so the text follows the active language. */
type Label = string | (() => string);

interface ConnectionBreadcrumb {
  name: string | null;
  providerId: string | null;
  label: string | null;
  backLink: string;
  backLabel: Label;
  /** Account status, shown as a badge next to the title (null: unknown). */
  active: boolean | null;
  /** A custom provider, flagged next to the title. */
  custom: boolean;
}

export const connectionBreadcrumbSignal = signal<ConnectionBreadcrumb>({
  name: null,
  providerId: null,
  label: null,
  backLink: '/providers/subscriptions',
  backLabel: () => t('providers.kind.subscriptions'),
  active: null,
  custom: false,
});

export function connectionBreadcrumbName(): string | null {
  return connectionBreadcrumbSignal().name;
}

export function connectionBreadcrumbProviderId(): string | null {
  return connectionBreadcrumbSignal().providerId;
}

export function connectionBreadcrumbLabel(): string | null {
  return connectionBreadcrumbSignal().label;
}

export function connectionBreadcrumbBackLink(): string {
  return connectionBreadcrumbSignal().backLink;
}

export function connectionBreadcrumbBackLabel(): string {
  const label = connectionBreadcrumbSignal().backLabel;
  return typeof label === 'function' ? label() : label;
}

export function setConnectionBreadcrumb(
  name: string | null,
  backLink?: string,
  backLabel?: Label,
  providerId?: string,
  label?: string,
  status?: { active: boolean; custom: boolean },
): void {
  connectionBreadcrumbSignal.set((prev) => ({
    name,
    providerId: providerId ?? null,
    label: label ?? null,
    backLink: backLink ?? prev.backLink,
    backLabel: backLabel ?? prev.backLabel,
    active: status?.active ?? null,
    custom: status?.custom ?? false,
  }));
}
