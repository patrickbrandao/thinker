import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import CopyButton from './CopyButton.js';
import { IconButton, cx } from './ui.js';
import { getAgentKeySecret } from '../services/api/agent-keys.js';
import { t } from '../i18n/index.js';

/**
 * A key shown masked (`thk_abcd…`) with reveal and copy buttons when the full
 * key can be shown again. The secret is fetched on the first reveal only.
 */
export default function KeySecret({
  agentName,
  keyId,
  keyPrefix,
  recoverable,
  block,
}: {
  agentName: string;
  keyId: string;
  keyPrefix: string;
  recoverable: boolean;
  /** Field look (edit window) instead of the compact table cell. */
  block?: boolean;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);

  const reveal = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (!secret) {
      setLoading(true);
      try {
        const res = await getAgentKeySecret(agentName, keyId);
        if (!res.apiKey) return;
        setSecret(res.apiKey);
      } catch {
        return;
      } finally {
        setLoading(false);
      }
    }
    setRevealed(true);
  };

  const shown = revealed && secret ? secret : `${keyPrefix}…`;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code
        className={cx(
          'min-w-0 font-mono text-xs',
          block
            ? 'flex-1 truncate rounded-control border border-line bg-sunken px-3 py-2 text-ink'
            : cx('text-dim', revealed ? 'break-all' : 'truncate'),
        )}
      >
        {shown}
      </code>
      {recoverable ? (
        <>
          <IconButton
            label={revealed ? t('harnesses.key.hideAria') : t('harnesses.key.revealAria')}
            title={revealed ? t('harnesses.key.hideShort') : t('harnesses.key.revealShort')}
            onClick={() => void reveal()}
            disabled={loading}
          >
            {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </IconButton>
          {revealed && secret ? <CopyButton text={secret} /> : null}
        </>
      ) : null}
    </div>
  );
}
