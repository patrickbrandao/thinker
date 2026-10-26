import {
  VIRTUAL_MODEL_NAME_MAX_LENGTH,
  VIRTUAL_MODEL_NAME_PATTERN,
  isReservedVirtualModelName,
  validateVirtualModelName,
} from '../src/virtual-model';

describe('virtual model name', () => {
  it.each([
    'deepseek',
    'deepseek/flash',
    'deepseek/free',
    'xxx/yyy',
    'a',
    'claude-sonnet-4-5',
    'gpt-5.5',
    'qwen3:8b',
    'my_model',
    'A/B/C',
  ])('accepts %s', (name) => {
    expect(validateVirtualModelName(name)).toEqual({ ok: true, name });
  });

  it.each([
    '/deepseek',
    'deepseek/',
    'deep//seek',
    'deep seek',
    'deep"seek',
    "it's",
    'tab\tname',
    'nul\u0000',
    'ação',
    '/',
    'a/b/',
  ])('rejects %j', (name) => {
    expect(validateVirtualModelName(name).ok).toBe(false);
  });

  it('trims surrounding whitespace and keeps the casing', () => {
    expect(validateVirtualModelName('  DeepSeek/Flash ')).toEqual({
      ok: true,
      name: 'DeepSeek/Flash',
    });
  });

  it('requires a non-empty string', () => {
    expect(validateVirtualModelName('')).toEqual({ ok: false, error: 'Name is required' });
    expect(validateVirtualModelName('   ')).toEqual({ ok: false, error: 'Name is required' });
    expect(validateVirtualModelName(undefined)).toEqual({ ok: false, error: 'Name is required' });
    expect(validateVirtualModelName(42)).toEqual({ ok: false, error: 'Name is required' });
  });

  it('accepts exactly the maximum length and rejects one more', () => {
    const max = 'a'.repeat(VIRTUAL_MODEL_NAME_MAX_LENGTH);
    expect(validateVirtualModelName(max)).toEqual({ ok: true, name: max });
    expect(validateVirtualModelName(`${max}a`)).toEqual({
      ok: false,
      error: 'Name must be 64 characters or fewer',
    });
  });

  it.each(['auto', 'AUTO', 'Auto', ' aUtO '])('reserves %j', (name) => {
    expect(isReservedVirtualModelName(name)).toBe(true);
    const result = validateVirtualModelName(name);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('reserved');
  });

  it('does not reserve names that only contain auto', () => {
    expect(isReservedVirtualModelName('auto/fast')).toBe(false);
    expect(validateVirtualModelName('autopilot').ok).toBe(true);
  });

  it('matches long hostile input in linear time', () => {
    const hostile = `${'a/'.repeat(5000)}/`;
    const started = Date.now();
    expect(VIRTUAL_MODEL_NAME_PATTERN.test(hostile)).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
