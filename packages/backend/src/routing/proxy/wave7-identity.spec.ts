import { chatgptAccountId } from './provider-endpoints';
import { copilotRequestHeaders } from './provider-client';
import { classifyCaller } from './caller-classifier';

describe('client identity (wave 7)', () => {
  it('reads the ChatGPT account id claim from the access token', () => {
    const payload = Buffer.from(
      JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } }),
    ).toString('base64url');
    expect(chatgptAccountId(`h.${payload}.s`)).toBe('acct_1');
    expect(chatgptAccountId('opaque')).toBeUndefined();
  });

  it('marks Copilot vision requests and agent continuations', () => {
    expect(
      copilotRequestHeaders({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
      }),
    ).toEqual({ 'Copilot-Vision-Request': 'true', 'X-Initiator': 'user' });
    expect(copilotRequestHeaders({ messages: [{ role: 'tool', content: 'ok' }] })).toEqual({
      'X-Initiator': 'agent',
    });
  });

  it('recognizes the official Anthropic and async/Azure OpenAI SDK user agents', () => {
    expect(classifyCaller({ 'user-agent': 'AsyncAnthropic/Python 2.4.0' }).sdk).toBe(
      'anthropic-python',
    );
    expect(classifyCaller({ 'user-agent': 'Anthropic/JS 1.4.0' }).sdk).toBe('anthropic-js');
    expect(classifyCaller({ 'user-agent': 'AsyncOpenAI/Python 3.44.0' }).sdk).toBe('openai-python');
    expect(classifyCaller({ 'user-agent': 'AzureOpenAI/JS 7.49.0' }).sdk).toBe('openai-js');
  });
});
