import { useState } from 'react';
import CopyButton from './CopyButton.jsx';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

export default function CraftAgentSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? masked;
  const visibleKey = keyRevealed && apiKey ? apiKey : masked;

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.craft')}
          parts={{
            url: <code className={CHIP}>{baseUrl}</code>,
            copy: <CopyButton text={baseUrl} className="inline-flex size-6 align-middle" />,
            auto: <code className={CHIP}>auto</code>,
          }}
        />
      </SetupHint>

      <SnippetBlock
        code={visibleKey}
        copyText={copyKey}
        language="text"
        reveal={
          apiKey ? (
            <RevealButton revealed={keyRevealed} onToggle={() => setKeyRevealed((v) => !v)} />
          ) : null
        }
      />
    </SetupCard>
  );
}
