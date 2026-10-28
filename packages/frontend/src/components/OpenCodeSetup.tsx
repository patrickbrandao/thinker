import { useState } from 'react';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

function getOpenCodeConfig(baseUrl: string, apiKey: string): string {
  return `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "thinker": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Thinker",
      "options": {
        "baseURL": "${baseUrl}",
        "apiKey": "${apiKey}"
      },
      "models": {
        "auto": {
          "name": "Thinker Auto"
        }
      }
    }
  },
  "model": "thinker/auto"
}`;
}

const PLACEHOLDER_KEY = 'thk_YOUR_KEY';

export default function OpenCodeSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : PLACEHOLDER_KEY;
  const copyKey = apiKey ?? PLACEHOLDER_KEY;
  const visibleKey = !apiKey ? PLACEHOLDER_KEY : keyRevealed ? apiKey : masked;

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.openCode')}
          parts={{ file: <code className={CHIP}>~/.config/opencode/opencode.json</code> }}
        />
      </SetupHint>

      <SnippetBlock
        code={getOpenCodeConfig(baseUrl, visibleKey)}
        copyText={getOpenCodeConfig(baseUrl, copyKey)}
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
