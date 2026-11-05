import { t } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { getDefaultBaseUrl } from '../services/api/routing.js';

/**
 * Optional base URL of an API-key connection. Empty keeps the provider's
 * official URL (shown as the placeholder); "Restore default" empties it.
 */
export default function AccountBaseUrlField({
  provider,
  region,
  value,
  onChange,
  disabled,
  defaultUrl,
  id = 'account-base-url',
}: {
  provider: string;
  region?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Official URL when the caller already knows it (skips the lookup). */
  defaultUrl?: string | null;
  id?: string;
}) {
  const lookup = useResource(
    () => getDefaultBaseUrl(provider, 'api_key', region),
    [provider, region],
    {
      enabled: defaultUrl === undefined,
    },
  );
  const official = defaultUrl !== undefined ? defaultUrl : (lookup.data?.default_base_url ?? null);
  if (defaultUrl === undefined && lookup.data && !lookup.data.supports_base_url) return null;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <label className="label m-0" htmlFor={id}>
          {t('providerSetup.baseUrlField.label')}
        </label>
        {value.trim() ? (
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            disabled={disabled}
            onClick={() => onChange('')}
          >
            {t('providerSetup.baseUrlField.restore')}
          </button>
        ) : null}
      </div>
      <input
        id={id}
        className="field font-mono"
        type="url"
        autoComplete="off"
        placeholder={official ?? ''}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <p className="hint">
        {value.trim()
          ? t('providerSetup.baseUrlField.warning')
          : t('providerSetup.baseUrlField.hint')}
      </p>
    </div>
  );
}
