import { safeJsonStringify } from './safe-json';

describe('safeJsonStringify', () => {
  it('round-trips to the same value as JSON.stringify', () => {
    const value = { message: '<script>alert(1)</script> & co \u2028\u2029', n: 1, a: [true, null] };
    expect(JSON.parse(safeJsonStringify(value))).toEqual(value);
  });

  it('never emits raw HTML metacharacters', () => {
    const out = safeJsonStringify({ m: '<img src=x onerror=alert(1)> & </script>' });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).toContain('\\u003cimg');
  });

  it('matches JSON.stringify when there is nothing to escape', () => {
    const value = { id: 'chatcmpl-1', choices: [{ index: 0 }] };
    expect(safeJsonStringify(value)).toBe(JSON.stringify(value));
  });
});
