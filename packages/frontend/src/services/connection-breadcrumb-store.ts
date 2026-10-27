import { createSignal } from 'solid-js';
import { t } from '../i18n/index.js';

/** A label, or a getter so the text follows the active language. */
type Label = string | (() => string);

const [connName, setConnName] = createSignal<string | null>(null);
const [connProviderId, setConnProviderId] = createSignal<string | null>(null);
const [connLabel, setConnLabel] = createSignal<string | null>(null);
const [connBackLink, setConnBackLink] = createSignal<string>('/providers/subscriptions');
const [connBackLabel, setConnBackLabel] = createSignal<Label>(() =>
  t('providers.kind.subscriptions'),
);

export function connectionBreadcrumbName(): string | null {
  return connName();
}

export function connectionBreadcrumbProviderId(): string | null {
  return connProviderId();
}

export function connectionBreadcrumbLabel(): string | null {
  return connLabel();
}

export function connectionBreadcrumbBackLink(): string {
  return connBackLink();
}

export function connectionBreadcrumbBackLabel(): string {
  const label = connBackLabel();
  return typeof label === 'function' ? label() : label;
}

export function setConnectionBreadcrumb(
  name: string | null,
  backLink?: string,
  backLabel?: Label,
  providerId?: string,
  label?: string,
): void {
  setConnName(name);
  setConnProviderId(providerId ?? null);
  setConnLabel(label ?? null);
  if (backLink) setConnBackLink(backLink);
  if (backLabel) setConnBackLabel(() => backLabel);
}
