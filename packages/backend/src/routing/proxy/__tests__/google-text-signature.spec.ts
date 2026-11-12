import {
  createGoogleStreamState,
  fromGoogleResponse,
  textSignatureKey,
  toGoogleRequest,
  transformGoogleStreamChunk,
} from '../google-adapter';

describe('Gemini thoughtSignature on text parts', () => {
  const reply = (parts: Array<Record<string, unknown>>) => ({
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
  });

  it('extracts the signature of a text-only reply, keyed by its text', () => {
    const res = fromGoogleResponse(
      reply([{ text: 'Hello ' }, { text: 'world', thoughtSignature: 'sig-1' }]),
      'gemini-3.5-flash',
    );
    expect(res._extractedSignatures).toEqual([
      { toolCallId: textSignatureKey('Hello world'), signature: 'sig-1' },
    ]);
  });

  it('ignores text signatures when the reply has function calls', () => {
    const res = fromGoogleResponse(
      reply([
        { text: 'x', thoughtSignature: 'sig-t' },
        { functionCall: { id: 'c1', name: 'ls', args: {} }, thoughtSignature: 'sig-f' },
      ]),
      'gemini-3.5-flash',
    );
    expect(res._extractedSignatures).toEqual([{ toolCallId: 'c1', signature: 'sig-f' }]);
  });

  it('emits the text signature at the end of a stream', () => {
    const state = createGoogleStreamState();
    const a = transformGoogleStreamChunk(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hel' }] } }] }),
      'm',
      state,
    );
    expect(a.signatures).toEqual([]);
    const b = transformGoogleStreamChunk(
      JSON.stringify(reply([{ text: 'lo', thoughtSignature: 'sig-s' }])),
      'm',
      state,
    );
    expect(b.signatures).toEqual([{ toolCallId: textSignatureKey('Hello'), signature: 'sig-s' }]);
  });

  it('puts the cached signature back on the last part of the echoed reply', () => {
    const lookup = (key: string) => (key === textSignatureKey('Hello world') ? 'sig-1' : null);
    const req = toGoogleRequest(
      {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'Hello world' },
          { role: 'user', content: 'again' },
        ],
      },
      'gemini-3.5-flash',
      lookup,
    ) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(req.contents[1]!.parts).toEqual([{ text: 'Hello world', thoughtSignature: 'sig-1' }]);
    expect(req.contents[0]!.parts[0]).not.toHaveProperty('thoughtSignature');
  });
});
