import type { ModelParamDefinition } from 'thinker-shared';

/**
 * OpenRouter provider routing (report from NOC Norte, P8): the `provider`
 * object of the request body, configurable per route. Keys and types follow
 * docs/externos/api/api-openrouter.md (provider-selection). The client's own
 * `provider` object wins as a whole (`clientOwnsRoot`), and only the route
 * that sets it gets it: fallbacks keep OpenRouter's default routing. No
 * defaults, so nothing is sent unless configured.
 */
const routing = (
  path: string,
  def: Omit<ModelParamDefinition, 'path' | 'group' | 'clientOwnsRoot'>,
): ModelParamDefinition => ({
  path: `provider.${path}`,
  group: 'provider_routing',
  clientOwnsRoot: true,
  ...def,
});

export const OPENROUTER_PROVIDER_ROUTING_PARAMS: readonly ModelParamDefinition[] = [
  routing('order', {
    type: 'string_list',
    label: 'Provider order',
    description:
      'Provider slugs to try in this order (e.g. deepinfra, together). A manual order turns off OpenRouter session affinity, and with it the warm prompt cache.',
  }),
  routing('only', {
    type: 'string_list',
    label: 'Only these providers',
    description: 'Restrict the request to these provider slugs.',
  }),
  routing('ignore', {
    type: 'string_list',
    label: 'Ignore providers',
    description: 'Never route to these provider slugs.',
  }),
  routing('allow_fallbacks', {
    type: 'boolean',
    label: 'Allow other providers',
    description:
      'When off, OpenRouter fails instead of trying providers outside order/only (OpenRouter default: on).',
  }),
  routing('sort', {
    type: 'enum',
    values: ['price', 'throughput', 'latency'],
    label: 'Sort providers by',
    description: 'Rank candidate providers by price, throughput or latency.',
  }),
  routing('data_collection', {
    type: 'enum',
    values: ['allow', 'deny'],
    label: 'Data collection',
    description: 'deny: only providers that do not store or train on prompts.',
  }),
  routing('zdr', {
    type: 'boolean',
    label: 'Zero data retention',
    description: 'Only providers with a zero-data-retention policy.',
  }),
  routing('require_parameters', {
    type: 'boolean',
    label: 'Require parameter support',
    description: 'Only providers that support every parameter of the request.',
  }),
  routing('quantizations', {
    type: 'string_list',
    label: 'Quantizations',
    description: 'Allowed quantization levels (e.g. fp8, int4).',
  }),
  routing('enforce_distillable_text', {
    type: 'boolean',
    label: 'Distillable text only',
    description: 'Only providers whose terms allow distilling the output.',
  }),
  routing('preferred_min_throughput', {
    type: 'number',
    range: { min: 0 },
    label: 'Preferred min throughput',
    description: 'Tokens per second; slower providers are ranked last.',
  }),
  routing('preferred_max_latency', {
    type: 'number',
    range: { min: 0 },
    label: 'Preferred max latency',
    description: 'Seconds to first token; slower providers are ranked last.',
  }),
  routing('max_price.prompt', {
    type: 'number',
    range: { min: 0 },
    label: 'Max prompt price',
    description: 'USD per million prompt tokens; pricier providers are excluded.',
  }),
  routing('max_price.completion', {
    type: 'number',
    range: { min: 0 },
    label: 'Max completion price',
    description: 'USD per million completion tokens; pricier providers are excluded.',
  }),
];
