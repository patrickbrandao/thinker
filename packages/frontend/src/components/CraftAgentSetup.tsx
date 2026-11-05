import { useState } from 'react';
import { SNIPPET_MAX_TOKENS } from 'thinker-shared';
import CopyButton from './CopyButton.jsx';
import RichText from './RichText.jsx';
import { CHIP, RevealButton, SetupCard, SetupHint, SnippetBlock } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

/**
 * Fields of the Craft connection (`llmConnections[]` in config.json) that
 * lift its custom-endpoint defaults: 131072 context, 8192 output, no images.
 */
const CRAFT_LIMITS = JSON.stringify(
  {
    customEndpoint: {
      api: 'openai-completions',
      maxTokens: SNIPPET_MAX_TOKENS,
      supportsImages: true,
    },
    models: [{ id: 'auto', contextWindow: 200000, supportsImages: true }],
  },
  null,
  2,
);

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

      <SetupHint>
        <RichText
          text={t('harnesses.guides.craftLimits')}
          parts={{ file: <code className={CHIP}>~/.craft-agent/config.json</code> }}
        />
      </SetupHint>
      <SnippetBlock code={CRAFT_LIMITS} copyText={CRAFT_LIMITS} language="json" />
    </SetupCard>
  );
}
