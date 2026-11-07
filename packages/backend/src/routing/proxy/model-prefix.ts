import { stripVendorPrefix } from '../../common/constants/openai-models';

/**
 * Strip vendor prefix from model name (e.g. "anthropic/claude-sonnet-4" → "claude-sonnet-4").
 * Models synced from OpenRouter use vendor prefixes, but native APIs expect bare names.
 */
export function stripModelPrefix(model: string, endpointKey: string): string {
  // OpenRouter expects vendor prefixes.
  if (endpointKey === 'openrouter') return model;
  if (endpointKey === 'commandcode' || endpointKey === 'commandcode-anthropic') {
    return model.startsWith('commandcode/') ? model.slice('commandcode/'.length) : model;
  }
  // Custom providers, Fireworks, Groq, Hugging Face, Kilo, Nous, NVIDIA NIM, Ollama, Pioneer, and ClinePass: model IDs from these APIs contain
  // legitimate slash segments (e.g. "accounts/fireworks/models/deepseek-v3p1",
  // "MiniMaxAI/MiniMax-2.7", "meta-llama/llama-guard-4-12b", "anthropic/claude-sonnet-4.5",
  // "cline-pass/deepseek-v4-flash"). Stripping would mangle the name the upstream API expects.
  if (
    endpointKey === 'custom' ||
    endpointKey === 'fireworks' ||
    endpointKey === 'groq' ||
    endpointKey === 'huggingface' ||
    endpointKey === 'kilo' ||
    endpointKey === 'nous' ||
    endpointKey === 'nvidia' ||
    endpointKey === 'cline-pass' ||
    endpointKey === 'ollama' ||
    endpointKey === 'ollama-cloud' ||
    // LM Studio serves hub ids such as `qwen/qwen3-8b`; llama-server echoes
    // whatever `--alias` or file path it was started with.
    endpointKey === 'lmstudio' ||
    endpointKey === 'llamacpp' ||
    endpointKey === 'pioneer'
  )
    return model;
  return stripVendorPrefix(model);
}
