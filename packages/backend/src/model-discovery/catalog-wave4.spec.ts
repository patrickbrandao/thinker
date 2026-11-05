import { filterNonChatModels } from './provider-model-fetcher.service';
import type { DiscoveredModel } from './model-fetcher';

const model = (id: string): DiscoveredModel => ({
  id,
  displayName: id,
  provider: 'p',
  contextWindow: 1000,
  inputPricePerToken: null,
  outputPricePerToken: null,
  capabilityReasoning: false,
  capabilityCode: false,
  qualityScore: 3,
});

describe('catalog filters (wave 4)', () => {
  it('hides Vertex ids past their retirement date only', () => {
    const ids = filterNonChatModels(
      [model('gemini-2.5-pro'), model('gemini-3.8-flash'), model('gemini-3.7-flash')],
      'vertex',
    ).map((m) => m.id);
    expect(ids).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash']);
  });

  it('drops non-chat models newly listed by OpenAI, Gemini, Qwen and BytePlus', () => {
    expect(filterNonChatModels([model('gpt-live-1'), model('gpt-6.1-sol')], 'openai')).toHaveLength(
      1,
    );
    expect(
      filterNonChatModels(
        [model('gemini-omni-1.1-flash'), model('gemini-3.5-transcribe'), model('gemini-3.8-flash')],
        'gemini',
      ).map((m) => m.id),
    ).toEqual(['gemini-3.8-flash']);
    expect(
      filterNonChatModels(
        [
          model('wan3.0-video'),
          model('happyhorse-1.1-x'),
          model('qwen-audio-3.0-asr-flash'),
          model('qwen3.8-max'),
        ],
        'qwen-subscription',
      ).map((m) => m.id),
    ).toEqual(['qwen3.8-max']);
    expect(
      filterNonChatModels(
        [model('seedream-3-0-t2i-250415'), model('dola-seed-2.0-pro')],
        'byteplus',
      ).map((m) => m.id),
    ).toEqual(['dola-seed-2.0-pro']);
  });
});
