import { useState } from 'react';
import { getClaudeCodeSettingsSnippet } from '../services/framework-snippets.js';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

export default function ClaudeCodeSetup({ apiKey, keyPrefix, baseUrl }: Props) {
  const [keyRevealed, setKeyRevealed] = useState(false);

  const masked = keyPrefix ? `${keyPrefix}...` : 'thk_YOUR_KEY';
  const copyKey = apiKey ?? masked;
  const visibleKey = keyRevealed && apiKey ? apiKey : masked;

  return (
    <SetupCard>
      <SetupHint>
        <RichText
          text={t('harnesses.guides.claudeSettings')}
          parts={{
            file: <code className={CHIP}>~/.claude/settings.json</code>,
            cmd: <code className={CHIP}>claude</code>,
            auto: <code className={CHIP}>auto</code>,
          }}
        />
      </SetupHint>

      <SnippetBlock
        code={getClaudeCodeSettingsSnippet(baseUrl, visibleKey)}
        copyText={getClaudeCodeSettingsSnippet(baseUrl, copyKey)}
        language="json"
        reveal={
          apiKey ? (
            <RevealButton revealed={keyRevealed} onToggle={() => setKeyRevealed((v) => !v)} />
          ) : null
        }
      />

      <SetupHint>
        <RichText
          text={t('harnesses.guides.claudeContext')}
          parts={{
            auto: <code className={CHIP}>auto</code>,
            example: <code className={CHIP}>/model claude-opus-5-5[1m]</code>,
          }}
        />
      </SetupHint>
    </SetupCard>
  );
}
