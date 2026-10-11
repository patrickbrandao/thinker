import { isLocalOnlyProvider } from './provider-availability';

describe('provider availability', () => {
  it('recognizes canonical local providers and their aliases', () => {
    expect(isLocalOnlyProvider('ollama')).toBe(true);
    expect(isLocalOnlyProvider(' LM Studio ')).toBe(true);
    expect(isLocalOnlyProvider('lm.studio')).toBe(true);
    expect(isLocalOnlyProvider('llama.cpp')).toBe(true);
    expect(isLocalOnlyProvider('llama_cpp')).toBe(true);
    expect(isLocalOnlyProvider('openai')).toBe(false);
    expect(isLocalOnlyProvider('custom:runtime-id')).toBe(false);
  });
});
