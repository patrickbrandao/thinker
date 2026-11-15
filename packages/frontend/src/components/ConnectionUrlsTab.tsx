import { t, tMaybe } from '../i18n/index.js';
import type { ProviderUrlSlotInfo, UrlOverrides } from '../services/api/provider-urls.js';
import { cx } from './ui.js';

/** What the user typed per slot id; '' (or missing) keeps the default. */
export type UrlDraft = Record<string, string>;

const MAX_URL_LENGTH = 2048;

/** Label of a slot's purpose; an unknown purpose shows the slot id. */
export function urlSlotLabel(slot: Pick<ProviderUrlSlotInfo, 'id' | 'purpose'>): string {
  return tMaybe(`providerSetup.urls.purpose.${slot.purpose}`) ?? slot.id;
}

/**
 * Client-side shape check of an override (the backend validates again):
 * http(s), no credentials, no fragment, and no query unless the slot's
 * default already has one. Returns the error message, or null when valid.
 */
export function validateUrlOverride(
  value: string,
  slot: Pick<ProviderUrlSlotInfo, 'default'>,
): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > MAX_URL_LENGTH) return t('providerSetup.urls.errors.tooLong');
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return t('providerSetup.urls.errors.invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return t('providerSetup.urls.errors.scheme');
  }
  if (url.username || url.password) return t('providerSetup.urls.errors.credentials');
  if (v.includes('#')) return t('providerSetup.urls.errors.fragment');
  if (v.includes('?') && !slot.default?.includes('?')) return t('providerSetup.urls.errors.query');
  return null;
}

/** Errors of the draft by slot id; empty when every value is valid. */
export function urlDraftErrors(
  slots: ProviderUrlSlotInfo[],
  draft: UrlDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const slot of slots) {
    const error = validateUrlOverride(draft[slot.id] ?? '', slot);
    if (error) errors[slot.id] = error;
  }
  return errors;
}

/** Overrides for a new account: only the slots the user filled in. */
export function urlOverridesToCreate(slots: ProviderUrlSlotInfo[], draft: UrlDraft): UrlOverrides {
  const out: UrlOverrides = {};
  for (const slot of slots) {
    const v = (draft[slot.id] ?? '').trim();
    if (v) out[slot.id] = v;
  }
  return out;
}

/**
 * Changes of an existing account against its stored values: a changed
 * slot maps to its new URL, a cleared one to null (back to the default).
 */
export function urlOverrideChanges(
  slots: Array<ProviderUrlSlotInfo & { value?: string | null }>,
  draft: UrlDraft,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const slot of slots) {
    const before = (slot.value ?? '').trim();
    const after = (draft[slot.id] ?? before).trim();
    if (after !== before) out[slot.id] = after || null;
  }
  return out;
}

/** Initial draft of an existing account: its stored overrides. */
export function urlDraftFrom(slots: Array<{ id: string; value?: string | null }>): UrlDraft {
  const out: UrlDraft = {};
  for (const slot of slots) if (slot.value) out[slot.id] = slot.value;
  return out;
}

/**
 * The "URLs" tab of an account: one row per URL slot, the default as the
 * placeholder, "Restore default", and a warning on slots that receive the
 * account's credential. Controlled; the host saves.
 */
export default function ConnectionUrlsTab({
  slots,
  value,
  onChange,
  disabled: disabledProp,
  locked,
  loading,
  error,
  idPrefix = 'connection-url',
}: {
  slots: ProviderUrlSlotInfo[];
  value: UrlDraft;
  onChange: (next: UrlDraft) => void;
  disabled?: boolean;
  /** The user's role can't change these URLs: read-only, with a note. */
  locked?: boolean;
  loading?: boolean;
  /** A save error shown above the rows. */
  error?: string | null;
  idPrefix?: string;
}) {
  const disabled = disabledProp || locked;
  if (loading && slots.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted">
        <span className="spinner" aria-hidden="true" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }
  return (
    <div className="connection-urls flex flex-col gap-4">
      <p className="m-0 text-sm text-muted">{t('providerSetup.urls.intro')}</p>
      {locked ? (
        <p className="notice is-info m-0 text-sm" role="note">
          {t('providerSetup.urls.ownerOnly')}
        </p>
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      {slots.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('providerSetup.urls.empty')}</p>
      ) : null}
      {slots.map((slot) => {
        const id = `${idPrefix}-${slot.id}`;
        const v = value[slot.id] ?? '';
        const rowError = validateUrlOverride(v, slot);
        const sendsCredential = slot.credential !== 'none';
        return (
          <div key={slot.id} className="connection-urls__row" data-slot={slot.id}>
            <div className="flex items-center justify-between gap-2">
              <label className="label m-0" htmlFor={id}>
                {urlSlotLabel(slot)}
              </label>
              {v.trim() ? (
                <button
                  type="button"
                  className="text-xs text-accent hover:underline"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, [slot.id]: '' })}
                  aria-label={t('providerSetup.urls.restoreNamed', { name: urlSlotLabel(slot) })}
                >
                  {t('providerSetup.urls.restore')}
                </button>
              ) : null}
            </div>
            <input
              id={id}
              className="field font-mono"
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={slot.default ?? ''}
              value={v}
              disabled={disabled}
              aria-invalid={rowError ? true : undefined}
              onChange={(e) => onChange({ ...value, [slot.id]: e.currentTarget.value })}
            />
            <p className="hint">
              <span className="font-mono text-faint">{slot.id}</span>
              {' · '}
              {slot.kind === 'base'
                ? t('providerSetup.urls.kindBase')
                : t('providerSetup.urls.kindUrl')}
            </p>
            {sendsCredential ? (
              <p className={cx('hint', v.trim() && 'text-warn')}>
                {t('providerSetup.urls.credentialWarning')}
              </p>
            ) : null}
            {rowError ? <p className="form-error mt-1">{rowError}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
