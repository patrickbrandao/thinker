import { Fragment, type ReactNode } from 'react';
import { listVirtualModels } from '../services/api/virtual-models.js';
import { useResource } from '../lib/use-resource.js';
import { CHIP } from './setup-ui.jsx';
import { t } from '../i18n/index.js';

/**
 * Fill a translated template whose `{{ name }}` placeholders stand for JSX
 * (code chips, links), keeping the surrounding text translatable.
 */
export function richText(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\{\s*\w+\s*\}\})/).map((segment, i) => {
    const match = /^\{\{\s*(\w+)\s*\}\}$/.exec(segment);
    return <Fragment key={i}>{match ? parts[match[1]!] : segment}</Fragment>;
  });
}

/**
 * Names of a harness's active virtual models (ADR 0004), in their configured
 * order. Loads quietly: a setup screen still works without them. Pass a falsy
 * name to skip loading (e.g. while a modal is closed).
 */
export function useActiveVirtualModelNames(agentName: string | null | undefined): string[] {
  const { data } = useResource(
    () => (agentName ? listVirtualModels(agentName).catch(() => []) : Promise.resolve([])),
    [agentName],
    { enabled: !!agentName },
  );
  return agentName ? (data ?? []).filter((v) => v.enabled).map((v) => v.name) : [];
}

const code = (text: string) => <code className={CHIP}>{text}</code>;

/** How each harness picks a model, and whether its picker reads `/v1/models`. */
function howToUse(platform: string | null | undefined, example: string): ReactNode {
  switch (platform) {
    case 'claude-code':
      return richText(t('models.hint.claudeCode'), {
        a: code(`/model ${example}`),
        b: code(`"model": "${example}"`),
        c: code('settings.json'),
      });
    case 'codex':
      return richText(t('models.hint.codex'), {
        a: code(`model = "${example}"`),
        b: code('config.toml'),
        c: code(`codex -m ${example}`),
      });
    case 'opencode':
      return richText(t('models.hint.opencode'), {
        a: code('providers.thinker.models'),
        b: code(`thinker/${example}`),
      });
    case 'hermes':
      return richText(t('models.hint.hermes'), {
        a: code('hermes model'),
        b: code('/v1/models'),
        c: code('auto'),
        d: code(`default: ${example}`),
      });
    case 'openclaw':
      return richText(t('models.hint.openclaw'), {
        a: code('auto'),
        b: code(`thinker/${example}`),
      });
    case 'nanobot':
      return richText(t('models.hint.nanobot'), {
        a: code('agents.defaults.model'),
        b: code('auto'),
      });
    case 'n8n':
      return richText(t('models.hint.n8n'), {
        a: code('/v1/models'),
        b: code('auto'),
      });
    case 'toolkits':
      return t('models.hint.toolkits');
    default:
      return richText(t('models.hint.default'), { a: code('auto') });
  }
}

interface Props {
  names: readonly string[];
  /** Harness platform id, or `toolkits` for the SDK snippets. */
  platform?: string | null;
}

/**
 * Setup-screen note listing the harness's active virtual models as values of
 * `model`, next to `auto` (ADR 0004, "Snippets de setup").
 */
export default function VirtualModelsHint({ names, platform }: Props) {
  if (names.length === 0) return null;
  return (
    <p
      className="setup-virtual-models mt-3 text-[13px] leading-relaxed text-dim"
      data-testid="virtual-models-hint"
    >
      {t('models.hint.intro')}{' '}
      <span className="setup-virtual-models__names inline-flex flex-wrap gap-1">
        {names.map((name) => (
          <code className={CHIP} key={name}>
            {name}
          </code>
        ))}
      </span>
      . {howToUse(platform, names[0]!)}
    </p>
  );
}
