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
}

export const connectionBreadcrumbSignal = signal<ConnectionBreadcrumb>({
  name: null,
  providerId: null,
  label: null,
  backLink: '/providers/subscriptions',
  backLabel: () => t('providers.kind.subscriptions'),
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
): void {
  connectionBreadcrumbSignal.set((prev) => ({
    name,
    providerId: providerId ?? null,
    label: label ?? null,
    backLink: backLink ?? prev.backLink,
    backLabel: backLabel ?? prev.backLabel,
  }));
}
