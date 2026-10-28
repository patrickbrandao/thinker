import { useState } from 'react';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  /** Active virtual models of the harness, listed after `auto`. */
  virtualModels?: readonly string[];
}

/**
 * opencode.json in the OpenCode 2 format (`providers`, `package`, `settings`).
 * Lists `auto` (default routing) and each virtual model of the harness.
 */
export function getOpenCodeConfig(
  baseUrl: string,
  apiKey: string,
  virtualModels: readonly string[] = [],
): string {
  const models: Record<string, { name: string }> = { auto: { name: 'Thinker Auto' } };
  for (const name of virtualModels) {
    if (name !== 'auto') models[name] = { name: `Thinker ${name}` };
  }
  const config = {
    $schema: 'https://opencode.ai/config.json',
    providers: {
      thinker: {
        package: 'aisdk:@ai-sdk/openai-compatible',
        name: 'Thinker',
        settings: { baseURL: baseUrl, apiKey },
        models,
      },
    },
    model: 'thinker/auto',
  };
  return JSON.stringify(config, null, 2);
}

const PLACEHOLDER_KEY = 'thk_YOUR_KEY';

export default function OpenCodeSetup({ apiKey, keyPrefix, baseUrl, virtualModels = [] }: Props) {
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
        code={getOpenCodeConfig(baseUrl, visibleKey, virtualModels)}
        copyText={getOpenCodeConfig(baseUrl, copyKey, virtualModels)}
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
