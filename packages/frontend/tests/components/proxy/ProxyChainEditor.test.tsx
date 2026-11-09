import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ProxyChainEditor from '../../../src/components/proxy/ProxyChainEditor';
import { newLine } from '../../../src/components/proxy/proxy-chain';
import { resetLocaleForTests, t } from '../../../src/i18n';
import type { ProfileLineInput } from '../../../src/services/api/proxies';
import { proxyView } from './fixtures';

const alpha = proxyView({ id: 'a', name: 'Alpha' });
const beta = proxyView({ id: 'b', name: 'Beta' });
const gamma = proxyView({ id: 'c', name: 'Gamma', enabled: false });
const P = (id: string) => newLine('proxy', [id]);
const D = newLine('direct');

function ui(value: ProfileLineInput[], onChange = vi.fn(), proxies = [alpha, beta, gamma]) {
  return (
    <MemoryRouter>
      <ProxyChainEditor value={value} onChange={onChange} proxies={proxies} />
    </MemoryRouter>
  );
}

/** Controlled wrapper so edits can be followed end to end. */
function Stateful({
  initial,
  proxies,
}: {
  initial: ProfileLineInput[];
  proxies?: (typeof alpha)[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <MemoryRouter>
      <ProxyChainEditor
        value={value}
        onChange={setValue}
        proxies={proxies ?? [alpha, beta, gamma]}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </MemoryRouter>
  );
}

const current = () =>
  JSON.parse(screen.getByTestId('value').textContent ?? '[]') as ProfileLineInput[];
const options = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);

describe('ProxyChainEditor', () => {
  it('shows the empty hint and adds a proxy line with the first free proxy', () => {
    const onChange = vi.fn();
    render(ui([], onChange));
    expect(screen.getByText('Add at least one proxy.')).toBeTruthy();
    expect(options('Line to add')).toEqual(['proxy', 'affinity', 'request']);
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(onChange).toHaveBeenCalledWith([P('a')]);
  });

  it('offers each proxy once in the whole profile', () => {
    render(ui([P('a'), newLine('request', ['b'])]));
    expect(options('Proxy of line 1')).toEqual(['a', 'c']);
    expect(options('Add a proxy to line 2')).toEqual(['', 'c']);
  });

  it('offers Direct once and never as the first line', () => {
    const { rerender } = render(ui([P('a')]));
    expect(options('Line to add')).toContain('direct');
    expect(options('Type of line 1')).not.toContain('direct');
    rerender(ui([P('a'), D]));
    expect(options('Line to add')).not.toContain('direct');
  });

  it('builds a balanced line: members, on failure and without session', () => {
    render(<Stateful initial={[]} />);
    fireEvent.change(screen.getByLabelText('Line to add'), { target: { value: 'affinity' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Add a proxy to line 1'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('On failure'), { target: { value: 'next_line' } });
    fireEvent.change(screen.getByLabelText('Without session'), { target: { value: 'first' } });
    expect(current()).toEqual([
      { mode: 'affinity', proxies: ['a', 'b'], on_failure: 'next_line', no_session: 'first' },
    ]);
    expect(screen.getByText(/always leaves through the same proxy/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove Alpha'));
    expect(current()[0]!.proxies).toEqual(['b']);
  });

  it('switching a balanced line to a proxy line keeps its first proxy; per request hides "without session"', () => {
    render(<Stateful initial={[newLine('affinity', ['a', 'b'])]} />);
    fireEvent.change(screen.getByLabelText('Type of line 1'), { target: { value: 'request' } });
    expect(screen.queryByLabelText('Without session')).toBeNull();
    fireEvent.change(screen.getByLabelText('Type of line 1'), { target: { value: 'proxy' } });
    expect(current()).toEqual([P('a')]);
  });

  it('reorders and removes lines; later lines carry the Fallback badge', () => {
    render(<Stateful initial={[P('a'), P('b'), D]} />);
    const items = () => screen.getAllByRole('listitem');
    expect(within(items()[0]!).queryByText('Fallback')).toBeNull();
    expect(within(items()[1]!).getByText('Fallback')).toBeTruthy();
    expect((within(items()[0]!).getByLabelText('Move up') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(within(items()[0]!).getByLabelText('Move down'));
    expect(current().map((l) => l.proxies[0] ?? 'direct')).toEqual(['b', 'a', 'direct']);
    fireEvent.click(screen.getByLabelText('Remove line 3'));
    expect(current()).toHaveLength(2);
  });

  it('flags a disabled proxy in a line', () => {
    render(ui([P('a'), newLine('request', ['b', 'c'])]));
    expect(within(screen.getAllByRole('listitem')[1]!).getByText('Disabled')).toBeTruthy();
  });

  it('locks adding at 6 lines and says so', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      proxyView({ id, name: id.toUpperCase() }),
    );
    render(ui([P('a'), P('b'), P('c'), P('d'), P('e'), D], vi.fn(), many));
    expect((screen.getByRole('button', { name: 'Add line' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('A profile holds up to 6 lines.')).toBeTruthy();
  });

  it('with no proxy servers shows a link to create one instead of the picker', () => {
    render(ui([], vi.fn(), []));
    expect(screen.getByRole('link', { name: 'Add one' }).getAttribute('href')).toBe(
      '/proxy-servers/new',
    );
    expect(screen.queryByLabelText('Line to add')).toBeNull();
  });

  it('renders in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(ui([P('a'), P('b')]));
    expect(screen.getByLabelText(t('proxies.binding.addLabel'))).toBeTruthy();
    expect(t('proxies.lines.addLine')).not.toBe('Add line');
    expect(screen.queryByLabelText('Move up')).toBeNull();
  });
});
