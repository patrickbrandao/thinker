import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  ModelParamsSection,
  RequestHeadersSection,
  formatParamValue,
} from '../../src/components/MessageDetailsSections';
import { resetLocaleForTests } from '../../src/i18n';

describe('formatParamValue', () => {
  it('uses an em dash for undefined and the word null for null', () => {
    expect(formatParamValue(undefined)).toBe('—');
    expect(formatParamValue(null)).toBe('null');
  });

  it('stringifies primitives, including falsy ones', () => {
    expect(formatParamValue('x')).toBe('x');
    expect(formatParamValue('')).toBe('');
    expect(formatParamValue(0)).toBe('0');
    expect(formatParamValue(0.2)).toBe('0.2');
    expect(formatParamValue(false)).toBe('false');
    expect(formatParamValue(true)).toBe('true');
  });

  it('pretty-prints objects and arrays with two-space indent', () => {
    expect(formatParamValue({ mode: 'permissive' })).toBe('{\n  "mode": "permissive"\n}');
    expect(formatParamValue([1, 2])).toBe('[\n  1,\n  2\n]');
  });
});

describe('RequestHeadersSection', () => {
  const headers = {
    'x-b': '2',
    Authorization: 'Bearer ***',
    ':method': 'POST',
    ':path': '/v1/messages',
    ':version': 'HTTP/1.1',
  };

  it('is collapsed by default with a count badge and no table', () => {
    render(<RequestHeadersSection headers={headers} />);
    const toggle = screen.getByRole('button', { name: /request headers/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // 2 headers + the request line row.
    expect(within(toggle).getByText('3')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('expands to a table with the request line first, then headers sorted by name', () => {
    render(<RequestHeadersSection headers={headers} />);
    const toggle = screen.getByRole('button', { name: /request headers/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(
      document.querySelector('.table-wrap')!.getAttribute('id'),
    );
    const rows = screen.getAllByRole('row').slice(1);
    const cells = rows.map((r) =>
      within(r)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    );
    expect(cells).toEqual([
      ['Request line', 'POST /v1/messages HTTP/1.1'],
      ['Authorization', 'Bearer ***'],
      ['x-b', '2'],
    ]);
    fireEvent.click(toggle);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('omits the request line when no pseudo-headers exist', () => {
    render(<RequestHeadersSection headers={{ a: '1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /request headers/i }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText('Request line')).toBeNull();
  });

  it('handles an empty header map', () => {
    render(<RequestHeadersSection headers={{}} />);
    const toggle = screen.getByRole('button', { name: /request headers/i });
    expect(within(toggle).getByText('0')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('gives two sections on the page distinct control ids', () => {
    render(
      <>
        <RequestHeadersSection headers={{ a: '1' }} />
        <RequestHeadersSection headers={{ b: '2' }} />
      </>,
    );
    const [one, two] = screen.getAllByRole('button');
    expect(one.getAttribute('aria-controls')).not.toBe(two.getAttribute('aria-controls'));
  });
});

describe('ModelParamsSection', () => {
  it('lists parameters sorted by name with formatted values', () => {
    render(
      <ModelParamsSection
        params={{ temperature: 0.2, reasoning: { effort: 'high' }, stop: undefined, seed: null }}
      />,
    );
    const toggle = screen.getByRole('button', { name: /model parameters/i });
    expect(within(toggle).getByText('4')).toBeTruthy();
    fireEvent.click(toggle);
    const rows = screen.getAllByRole('row').slice(1);
    const keys = rows.map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(keys).toEqual(['reasoning', 'seed', 'stop', 'temperature']);
    const byKey = Object.fromEntries(
      rows.map((r) => {
        const c = within(r).getAllByRole('cell');
        return [c[0].textContent, c[1].textContent];
      }),
    );
    expect(byKey.reasoning).toBe('{\n  "effort": "high"\n}');
    expect(byKey.seed).toBe('null');
    expect(byKey.stop).toBe('—');
    expect(byKey.temperature).toBe('0.2');
  });

  it('is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<ModelParamsSection params={{ a: 1 }} />);
    expect(screen.queryByRole('button', { name: /model parameters/i })).toBeNull();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
