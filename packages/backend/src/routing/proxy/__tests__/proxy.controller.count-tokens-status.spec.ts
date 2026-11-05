import 'reflect-metadata';
import { ProxyController } from '../proxy.controller';

describe('POST /v1/messages/count_tokens status', () => {
  it('answers 200 like Anthropic, not the 201 Nest uses for POST by default', () => {
    expect(Reflect.getMetadata('__httpCode__', ProxyController.prototype.countTokens)).toBe(200);
  });
});
