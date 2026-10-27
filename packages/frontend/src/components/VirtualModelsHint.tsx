import { createResource, For, Show, type Accessor, type Component, type JSX } from 'solid-js';
import { listVirtualModels } from '../services/api/virtual-models.js';
import { t } from '../i18n/index.js';

/**
 * Fill a translated template whose `{{ name }}` placeholders stand for JSX
 * (code chips, links), keeping the surrounding text translatable.
 */
export function richText(template: string, parts: Record<string, JSX.Element>): JSX.Element {
  return template.split(/(\{\{\s*\w+\s*\}\})/).map((segment) => {
    const match = /^\{\{\s*(\w+)\s*\}\}$/.exec(segment);
    return match ? parts[match[1]!] : segment;
  }) as unknown as JSX.Element;
}

/**
 * Names of a harness's active virtual models (ADR 0004), in their configured
 * order. Loads quietly: a setup screen still works without them.
 */
export function createActiveVirtualModelNames(
  agentName: Accessor<string | null | undefined>,
): Accessor<string[]> {
  const [list] = createResource(
    () => agentName() || null,
    (name) => listVirtualModels(name).catch(() => []),
  );
  return () => (list() ?? []).filter((v) => v.enabled).map((v) => v.name);
}

const code = (text: string) => <code class="setup-model-hint__code">{text}</code>;

/** How each harness picks a model, and whether its picker reads `/v1/models`. */
function howToUse(platform: string | null | undefined, example: string): JSX.Element {
  switch (platform) {
    case 'claude-code':
      return (
        <>
          {richText(t('models.hint.claudeCode'), {
            a: code(`/model ${example}`),
            b: code(`"model": "${example}"`),
            c: code('settings.json'),
          })}
        </>
      );
    case 'codex':
      return (
        <>
          {richText(t('models.hint.codex'), {
            a: code(`model = "${example}"`),
            b: code('config.toml'),
            c: code(`codex -m ${example}`),
          })}
        </>
      );
    case 'opencode':
      return (
        <>
          {richText(t('models.hint.opencode'), {
            a: code('provider.thinker.models'),
            b: code(`thinker/${example}`),
          })}
        </>
      );
    case 'hermes':
      return (
        <>
          {richText(t('models.hint.hermes'), {
            a: code('hermes model'),
            b: code('/v1/models'),
            c: code('auto'),
            d: code(`default: ${example}`),
          })}
        </>
      );
    case 'openclaw':
      return (
        <>
          {richText(t('models.hint.openclaw'), {
            a: code('auto'),
            b: code(`thinker/${example}`),
          })}
        </>
      );
    case 'nanobot':
      return (
        <>
          {richText(t('models.hint.nanobot'), {
            a: code('agents.defaults.model'),
            b: code('auto'),
          })}
        </>
      );
    case 'n8n':
      return (
        <>
          {richText(t('models.hint.n8n'), {
            a: code('/v1/models'),
            b: code('auto'),
          })}
        </>
      );
    case 'toolkits':
      return <>{t('models.hint.toolkits')}</>;
    default:
      return <>{richText(t('models.hint.default'), { a: code('auto') })}</>;
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
const VirtualModelsHint: Component<Props> = (props) => (
  <Show when={props.names.length > 0}>
    <p class="setup-method__hint setup-virtual-models" data-testid="virtual-models-hint">
      {t('models.hint.intro')}{' '}
      <span class="setup-virtual-models__names">
        <For each={props.names}>{(name) => code(name)}</For>
      </span>
      . {howToUse(props.platform, props.names[0]!)}
    </p>
  </Show>
);

export default VirtualModelsHint;
