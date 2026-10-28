import { useState } from 'react';
import { getCodexConfigSnippet, getCodexKeyExportSnippet } from 'thinker-shared';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

const PLACEHOLDER_KEY = 'thk_YOUR_KEY';

export default function CodexSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : PLACEHOLDER_KEY;
  const copyKey = apiKey ?? PLACEHOLDER_KEY;
  const visibleKey = !apiKey ? PLACEHOLDER_KEY : keyRevealed ? apiKey : masked;
  const config = getCodexConfigSnippet(baseUrl);

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.codexConfig')}
          parts={{ file: <code className={CHIP}>~/.codex/config.toml</code> }}
        />
      </SetupHint>

      <SnippetBlock code={config} copyText={config} language="toml" />

      <SetupHint>{t('harnesses.guides.codexExport')}</SetupHint>

      <SnippetBlock
        code={getCodexKeyExportSnippet(visibleKey)}
        copyText={getCodexKeyExportSnippet(copyKey)}
        language="bash"
        reveal={
          apiKey ? (
            <RevealButton revealed={keyRevealed} onToggle={() => setKeyRevealed((v) => !v)} />
          ) : null
        }
      />
    </SetupCard>
  );
}
