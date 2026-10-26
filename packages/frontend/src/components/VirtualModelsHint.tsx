import { createResource, For, Show, type Accessor, type Component, type JSX } from 'solid-js';
import { listVirtualModels } from '../services/api/virtual-models.js';

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
          Switch with {code(`/model ${example}`)}, or set {code(`"model": "${example}"`)} in{' '}
          {code('settings.json')}.
        </>
      );
    case 'codex':
      return (
        <>
          Set {code(`model = "${example}"`)} in {code('config.toml')}, or run{' '}
          {code(`codex -m ${example}`)}.
        </>
      );
    case 'opencode':
      return (
        <>
          Add each name under {code('provider.thinker.models')} and select{' '}
          {code(`thinker/${example}`)}.
        </>
      );
    case 'hermes':
      return (
        <>
          {code('hermes model')} reads the model list from {code('/v1/models')}, so they appear
          there next to {code('auto')}. You can also set {code(`default: ${example}`)}.
        </>
      );
    case 'openclaw':
      return (
        <>
          Use one as the Model ID instead of {code('auto')}, so the model reads{' '}
          {code(`thinker/${example}`)}.
        </>
      );
    case 'nanobot':
      return (
        <>
          Set {code('agents.defaults.model')} to one of them instead of {code('auto')}.
        </>
      );
    case 'n8n':
      return (
        <>
          The model list of n8n's OpenAI nodes reads {code('/v1/models')}, so they appear there next
          to {code('auto')}.
        </>
      );
    case 'toolkits':
      return <>Pick one above to put it in the snippet.</>;
    default:
      return <>Use one as the model name instead of {code('auto')}.</>;
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
      Virtual models on this harness can be used as the model too:{' '}
      <span class="setup-virtual-models__names">
        <For each={props.names}>{(name) => code(name)}</For>
      </span>
      . {howToUse(props.platform, props.names[0]!)}
    </p>
  </Show>
);

export default VirtualModelsHint;
