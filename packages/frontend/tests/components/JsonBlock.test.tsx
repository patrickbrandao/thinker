import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import JsonBlock from '../../src/components/JsonBlock';

describe('JsonBlock', () => {
  it('pretty-prints the value with two-space indentation', () => {
    const { container } = render(<JsonBlock value={{ a: 1, b: [true, null] }} />);
    expect(container.querySelector('pre')!.textContent).toBe(
      JSON.stringify({ a: 1, b: [true, null] }, null, 2),
    );
    expect(container.querySelector('code.language-json')).not.toBeNull();
  });

  it('applies both class props to the wrapper', () => {
    const { container } = render(<JsonBlock value={1} class="legacy" className="modern" />);
    const wrap = container.firstElementChild!;
    expect(wrap.className).toContain('json-block-wrap');
    expect(wrap.className).toContain('legacy');
    expect(wrap.className).toContain('modern');
  });

  it('escapes HTML in string values instead of injecting markup', () => {
    const { container } = render(<JsonBlock value={{ x: '<img src=x onerror=alert(1)>' }} />);
    expect(container.querySelector('pre img')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('skips highlighting above 50 KB and says so', () => {
    const big = 'x'.repeat(60_000);
    const { container } = render(<JsonBlock value={big} />);
    expect(container.querySelector('.hint')!.textContent).toContain('Highlighting skipped');
    expect(container.querySelector('.hint')!.textContent).toContain('59 KB');
    expect(container.querySelector('code.language-json')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toBe(JSON.stringify(big, null, 2));
  });

  it('highlights right at the limit boundary (no notice)', () => {
    // 49_990 chars + 2 quotes stays under 50_000.
    const { container } = render(<JsonBlock value={'y'.repeat(49_990)} />);
    expect(container.querySelector('.hint')).toBeNull();
    expect(container.querySelector('code.language-json')).not.toBeNull();
  });

  it('falls back to String() for values JSON cannot serialize', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { container } = render(<JsonBlock value={circular} />);
    expect(container.querySelector('pre')!.textContent).toBe('[object Object]');
    const big = render(<JsonBlock value={BigInt(10)} />);
    expect(big.container.querySelector('pre')!.textContent).toBe('10');
  });

  it('does not crash on a value JSON.stringify turns into undefined', () => {
    const { container } = render(<JsonBlock value={undefined} />);
    expect(container.querySelector('pre')).not.toBeNull();
  });
});
