import { sanitizeOpenAiBody } from '../provider-client-converters';

describe('MiniMax reasoning_effort (#195)', () => {
  it('keeps reasoning_effort for the MiniMax API', () => {
    const body = sanitizeOpenAiBody(
      { model: 'MiniMax-M3.1-Flash', messages: [], reasoning_effort: 'high' },
      'minimax',
      'MiniMax-M3.1-Flash',
    );
    expect(body['reasoning_effort']).toBe('high');
  });
});
