import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { revealConnectionKey } from '../services/api.js';
import { currentRole } from '../services/session-store.js';
import { maskedKeyLabel } from '../services/key-mask.js';
import { t } from '../i18n/index.js';
import CopyButton from './CopyButton.js';

/** Only plain API keys can be revealed: never subscription/OAuth credentials. */
export function isRevealableConnection(authType: string | null | undefined): boolean {
  return authType === 'api_key' || authType === 'local';
}

/**
 * A connection's stored key, masked by the server. The organization owner
 * gets an eye button that fetches the full key on demand (and a copy button
 * while it is shown); a second click hides it and drops it from memory.
 */
export default function ConnectionKeyField({
  connectionId,
  authType,
  keyMasked,
}: {
  connectionId: string;
  authType: string;
  keyMasked: string | null | undefined;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // A different connection (or a replaced key) never keeps the old plaintext.
  useEffect(() => {
    setRevealed(null);
    setError('');
  }, [connectionId, keyMasked]);

  if (!keyMasked) return null;
  const canReveal = isRevealableConnection(authType) && currentRole() === 'owner';

  const toggle = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await revealConnectionKey(connectionId);
      setRevealed(res.api_key);
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : t('providers.detail.revealKeyFailed'));
    } finally {
      setLoading(false);
    }
  };

  const toggleLabel = loading
    ? t('providers.detail.revealingKey')
    : revealed !== null
      ? t('providers.detail.hideKey')
      : t('providers.detail.showKey');

  return (
    <div className="connection-key mb-2">
      <span className="hint">{t('providers.detail.currentKey')}</span>
      <div className="flex items-center gap-1">
        <code
          className="connection-key__value min-w-0 flex-1 truncate font-mono text-sm text-ink"
          data-revealed={revealed !== null ? 'true' : undefined}
        >
          {revealed ?? maskedKeyLabel({ key_masked: keyMasked })}
        </code>
        {canReveal ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-pressed={revealed !== null}
            disabled={loading}
            onClick={() => void toggle()}
          >
            {revealed !== null ? (
              <EyeOff size={14} aria-hidden="true" />
            ) : (
              <Eye size={14} aria-hidden="true" />
            )}
          </button>
        ) : null}
        {canReveal && revealed !== null ? <CopyButton text={revealed} /> : null}
      </div>
      {error ? <p className="form-error mt-1">{error}</p> : null}
    </div>
  );
}
