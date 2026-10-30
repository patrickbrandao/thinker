import { useState, type ReactNode } from 'react';
import FrameworkSnippets from './FrameworkSnippets.jsx';
import OpenClawSetup from './OpenClawSetup.jsx';
import HermesSetup from './HermesSetup.jsx';
import NanobotSetup from './NanobotSetup.jsx';
import CraftAgentSetup from './CraftAgentSetup.jsx';
import N8nSetup from './N8nSetup.jsx';
import ClaudeCodeSetup from './ClaudeCodeSetup.jsx';
import OpenCodeSetup from './OpenCodeSetup.jsx';
import CodexSetup from './CodexSetup.jsx';
import VirtualModelsHint from './VirtualModelsHint.jsx';
import RichText from './RichText.jsx';
import { CHIP, monoIconClass, SetupHint, SetupSegment } from './setup-ui.jsx';
import { cx } from './ui.jsx';
import type { ToolkitId } from '../services/framework-snippets.js';
import { t } from '../i18n/index.js';

type SetupTab = 'toolkits' | 'agents';
type AgentId = 'openclaw' | 'hermes' | 'nanobot' | 'craft' | 'claude-code' | 'opencode' | 'codex';

interface Props {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
  hideFullKey?: boolean;
  platform?: string | null;
  /**
   * Names of the harness's active virtual models (ADR 0004), offered as
   * values of `model` next to `auto`.
   */
  virtualModels?: readonly string[];
}

const PLATFORM_TO_TOOLKIT: Record<string, ToolkitId> = {
  'openai-sdk': 'openai-sdk',
  'anthropic-sdk': 'anthropic-sdk',
  'vercel-ai-sdk': 'vercel-ai-sdk',
  langchain: 'langchain',
  curl: 'curl',
};

/** Harnesses named in "Connect your X harness to Thinker". */
const NAMED_HARNESSES: Record<string, string> = {
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  nanobot: 'Nanobot',
  craft: 'Craft',
};
/** Tools named in "Connect X to Thinker". */
const NAMED_TOOLS: Record<string, string> = {
  n8n: 'n8n',
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
};

/** Agent tabs of the unfiltered view, in display order. */
const AGENT_TABS: { id: AgentId; label: string; icon: string }[] = [
  { id: 'openclaw', label: 'OpenClaw', icon: '/icons/openclaw.svg' },
  { id: 'hermes', label: 'Hermes Agent', icon: '/icons/hermes.svg' },
  { id: 'nanobot', label: 'Nanobot', icon: '/icons/nanobot.png' },
  { id: 'craft', label: 'Craft Agent', icon: '/icons/craft.png' },
  { id: 'claude-code', label: 'Claude Code', icon: '/icons/providers/claude-code.svg' },
  { id: 'opencode', label: 'OpenCode', icon: '/icons/providers/opencode.svg' },
  { id: 'codex', label: 'Codex', icon: '/icons/codex.svg' },
];

function headingFor(platform: string | null | undefined): string {
  const harness = platform ? NAMED_HARNESSES[platform] : undefined;
  if (harness) return t('harnesses.setupStep.connectNamed', { name: harness });
  const tool = platform ? NAMED_TOOLS[platform] : undefined;
  if (tool) return t('harnesses.setupStep.connectTool', { name: tool });
  return t('harnesses.setupStep.connectDefault');
}

interface SnippetProps {
  apiKey: string | null;
  keyPrefix: string | null;
  baseUrl: string;
}

/** Guides that write the virtual models into the config themselves. */
type GuideProps = SnippetProps & { virtualModels: readonly string[] };

/** The guide for one harness, or null when it has none. */
function harnessGuide(
  id: string | null | undefined,
  { virtualModels, ...props }: GuideProps,
): ReactNode {
  switch (id) {
    case 'openclaw':
      return <OpenClawSetup {...props} />;
    case 'hermes':
      return <HermesSetup {...props} />;
    case 'nanobot':
      return <NanobotSetup {...props} />;
    case 'craft':
      return <CraftAgentSetup {...props} />;
    case 'n8n':
      return <N8nSetup {...props} />;
    case 'claude-code':
      return <ClaudeCodeSetup {...props} />;
    case 'opencode':
      return <OpenCodeSetup {...props} virtualModels={virtualModels} />;
    case 'codex':
      return <CodexSetup {...props} />;
    default:
      return null;
  }
}

export default function SetupStepAddProvider({
  apiKey,
  keyPrefix,
  baseUrl,
  hideFullKey,
  platform,
  virtualModels = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<SetupTab>('agents');
  const [activeAgent, setActiveAgent] = useState<AgentId>('openclaw');

  const snippetProps: SnippetProps = { apiKey, keyPrefix, baseUrl };
  const toolkitId = platform ? PLATFORM_TO_TOOLKIT[platform] : undefined;

  if (platform) {
    // Platform-filtered mode: show only the relevant guide.
    const guide = harnessGuide(platform, { ...snippetProps, virtualModels });
    const defaultToolkit = toolkitId ?? (platform === 'other' ? 'curl' : undefined);
    // Toolkit snippets carry their own model picker.
    const hintPlatform = toolkitId || platform === 'other' ? 'toolkits' : platform;
    return (
      <div>
        <h3 className="setup-step__heading text-[15px] font-semibold text-ink">
          {headingFor(platform)}
        </h3>
        {guide ??
          (defaultToolkit ? (
            <FrameworkSnippets
              {...snippetProps}
              hideFullKey={hideFullKey}
              defaultToolkit={defaultToolkit}
              modelOptions={virtualModels}
            />
          ) : null)}
        <VirtualModelsHint names={virtualModels} platform={hintPlatform} />
      </div>
    );
  }

  return (
    <div>
      <h3 className="setup-step__heading text-[15px] font-semibold text-ink">
        {headingFor(platform)}
      </h3>
      <SetupHint className="mb-3 mt-1">
        <RichText
          text={t('harnesses.setupStep.pointAt')}
          parts={{ model: <code className={CHIP}>auto</code> }}
        />
      </SetupHint>

      <SetupSegment
        label={t('harnesses.setupStep.method')}
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'agents', label: t('harnesses.setupStep.agents') },
          { key: 'toolkits', label: t('harnesses.setupStep.toolkits') },
        ]}
      />

      {activeTab === 'toolkits' ? (
        <>
          <FrameworkSnippets
            {...snippetProps}
            hideFullKey={hideFullKey}
            modelOptions={virtualModels}
          />
          <VirtualModelsHint names={virtualModels} platform="toolkits" />
        </>
      ) : (
        <>
          <div className="setup-method-tabs mt-3">
            <div
              className="tabs mb-0!"
              role="tablist"
              aria-label={t('harnesses.setupStep.framework')}
            >
              {AGENT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={cx('tab', activeAgent === tab.id && 'is-active')}
                  onClick={() => setActiveAgent(tab.id)}
                  role="tab"
                  aria-selected={activeAgent === tab.id}
                >
                  <img
                    src={tab.icon}
                    alt=""
                    className={cx('tab-icon', monoIconClass(tab.icon))}
                    width="16"
                    height="16"
                  />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {harnessGuide(activeAgent, { ...snippetProps, virtualModels })}
          <VirtualModelsHint names={virtualModels} platform={activeAgent} />
        </>
      )}
    </div>
  );
}
