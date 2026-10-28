import { useState } from 'react';
import { getNanobotConfigSnippet } from '../services/framework-snippets.js';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

export default function NanobotSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? masked;
  const visibleKey = keyRevealed && apiKey ? apiKey : masked;

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.nanobot')}
          parts={{
            file: <code className={CHIP}>~/.nanobot/config.json</code>,
            defaults: <code className={CHIP}>agents.defaults</code>,
            custom: <code className={CHIP}>custom</code>,
          }}
        />
      </SetupHint>

      <SnippetBlock
        code={getNanobotConfigSnippet(baseUrl, visibleKey)}
        copyText={getNanobotConfigSnippet(baseUrl, copyKey)}
        language="json"
        reveal={
          apiKey ? (
            <RevealButton revealed={keyRevealed} onToggle={() => setKeyRevealed((v) => !v)} />
          ) : null
        }
      />
    </SetupCard>
  );
}
