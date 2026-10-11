import { mergeExtraHeaders } from '../extra-headers';

const ADAPTER = {
  Authorization: 'Bearer stored',
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
};

describe('mergeExtraHeaders', () => {
  it('returns the adapter headers object itself when there are no extra headers', () => {
    expect(mergeExtraHeaders(ADAPTER, undefined)).toBe(ADAPTER);
    expect(mergeExtraHeaders(ADAPTER, {})).toBe(ADAPTER);
  });

  it('keeps a header the adapter does not set', () => {
    const merged = mergeExtraHeaders(ADAPTER, { 'X-Custom-Trace': 'trace-123' });
    expect(merged).toEqual({ ...ADAPTER, 'X-Custom-Trace': 'trace-123' });
  });

  it('does not mutate either input', () => {
    const adapter = { ...ADAPTER };
    const extra = { authorization: 'Bearer attacker', 'x-extra': '1' };
    mergeExtraHeaders(adapter, extra);
    expect(adapter).toEqual(ADAPTER);
    expect(extra).toEqual({ authorization: 'Bearer attacker', 'x-extra': '1' });
  });

  it.each([
    ['Authorization'],
    ['authorization'],
    ['AUTHORIZATION'],
    ['aUtHoRiZaTiOn'],
    [' authorization '],
  ])('drops a user %j that collides with the adapter Authorization', (name) => {
    const merged = mergeExtraHeaders(ADAPTER, { [name]: 'Bearer attacker' });
    // Exactly the adapter's set: no second spelling for fetch to comma-merge.
    expect(merged).toEqual(ADAPTER);
    expect(JSON.stringify(merged)).not.toContain('attacker');
  });

  it('lets the adapter win on a non-credential header too, in any casing', () => {
    const merged = mergeExtraHeaders(ADAPTER, {
      'Anthropic-Version': '2099-01-01',
      'x-other': 'kept',
    });
    expect(merged).toEqual({ ...ADAPTER, 'x-other': 'kept' });
  });

  it('matches adapter keys case-insensitively whatever casing the adapter used', () => {
    const merged = mergeExtraHeaders(
      { 'X-API-Key': 'stored', 'x-amz-target': 'Op.Stored' },
      { 'x-api-key': 'attacker', 'X-Amz-Target': 'Op.Other' },
    );
    expect(merged).toEqual({ 'X-API-Key': 'stored', 'x-amz-target': 'Op.Stored' });
  });

  it('keeps only the first spelling when the extra headers repeat a name', () => {
    const merged = mergeExtraHeaders(ADAPTER, {
      'X-Title': 'first',
      'x-title': 'second',
      'X-TITLE': 'third',
    });
    expect(merged).toEqual({ ...ADAPTER, 'X-Title': 'first' });
  });

  it('drops every repeated spelling of a name the adapter sets', () => {
    const merged = mergeExtraHeaders(ADAPTER, {
      authorization: 'Bearer a',
      Authorization: 'Bearer b',
    });
    expect(merged).toEqual(ADAPTER);
  });

  describe('anthropic-beta', () => {
    const SUBSCRIPTION = {
      Authorization: 'Bearer oat',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
    };

    it("appends the user's flags after the adapter's instead of replacing them", () => {
      const merged = mergeExtraHeaders(SUBSCRIPTION, {
        'Anthropic-Beta': 'structured-outputs-2025-11-13',
      });
      expect(merged).toEqual({
        Authorization: 'Bearer oat',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,structured-outputs-2025-11-13',
      });
    });

    it('never repeats a flag the adapter already sends', () => {
      const merged = mergeExtraHeaders(SUBSCRIPTION, { 'anthropic-beta': 'oauth-2025-04-20' });
      expect(merged['anthropic-beta']).toBe('claude-code-20250219,oauth-2025-04-20');
    });

    it('keeps the adapter flags when the user sends only malformed ones', () => {
      const merged = mergeExtraHeaders(SUBSCRIPTION, { 'anthropic-beta': 'NOT A FLAG' });
      expect(merged).toEqual(SUBSCRIPTION);
    });

    it('forwards sanitized user flags when the adapter sends none', () => {
      expect(
        mergeExtraHeaders(ADAPTER, { 'Anthropic-Beta': 'context-management-2025-06-27, Bad' }),
      ).toEqual({ ...ADAPTER, 'anthropic-beta': 'context-management-2025-06-27' });
    });

    it('drops the header when the adapter sends none and no user flag is valid', () => {
      expect(mergeExtraHeaders(ADAPTER, { 'anthropic-beta': 'Bad Flag' })).toEqual(ADAPTER);
    });
  });
});
