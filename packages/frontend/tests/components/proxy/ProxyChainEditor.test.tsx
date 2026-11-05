import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ProxyChainEditor from '../../../src/components/proxy/ProxyChainEditor';
import { resetLocaleForTests, t } from '../../../src/i18n';
import { proxyView } from './fixtures';

const alpha = proxyView({ id: 'a', name: 'Alpha' });
const beta = proxyView({ id: 'b', name: 'Beta' });
const gamma = proxyView({ id: 'c', name: 'Gamma', enabled: false });

function ui(value: string[], onChange = vi.fn(), proxies = [alpha, beta, gamma]) {
  return (
    <MemoryRouter>
      <ProxyChainEditor value={value} onChange={onChange} proxies={proxies} />
    </MemoryRouter>
  );
}

/** Controlled wrapper so reordering can be followed end to end. */
function Stateful({ initial, proxies }: { initial: string[]; proxies?: typeof alpha[] }) {
  const [value, setValue] = useState(initial);
  return (
    <MemoryRouter>
      <ProxyChainEditor value={value} onChange={setValue} proxies={proxies ?? [alpha, beta, gamma]} />
    </MemoryRouter>
  );
}

const names = () => screen.getAllByRole('listitem').map((li) => li.textContent ?? '');

describe('ProxyChainEditor', () => {
  it('shows the empty hint and adds the first available proxy when nothing is picked', () => {
    const onChange = vi.fn();
    render(ui([], onChange));
    expect(screen.getByText('Add at least one proxy.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('adds the picked proxy and offers only proxies not yet in the chain', () => {
    const onChange = vi.fn();
    render(ui(['a'], onChange));
    const select = screen.getByLabelText('Proxy to add') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['Pick a proxy or Direct…', 'Beta', 'Gamma (disabled)', 'Direct']);
    fireEvent.change(select, { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('does not offer Direct for an empty chain, nor twice', () => {
    const { rerender } = render(ui([]));
    let select = screen.getByLabelText('Proxy to add') as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 'direct')).toBe(false);
    rerender(ui(['a', 'direct']));
    select = screen.getByLabelText('Proxy to add') as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 'direct')).toBe(false);
  });

  it('appends Direct as a fallback item and labels it Direct', () => {
    render(<Stateful initial={['a']} />);
    fireEvent.change(screen.getByLabelText('Proxy to add'), { target: { value: 'direct' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[1]!).getByText('Direct')).toBeTruthy();
    // The first item is the primary; every later one carries the Fallback badge.
    expect(within(items[0]!).queryByText('Fallback')).toBeNull();
    expect(within(items[1]!).getByText('Fallback')).toBeTruthy();
  });

  it('reorders with the move buttons and disables the edges', () => {
    render(<Stateful initial={['a', 'b', 'direct']} />);
    expect(names().map((n) => n.replace(/\d|Fallback|Disabled/g, ''))).toEqual([
      'Alpha',
      'Beta',
      'Direct',
    ]);
    const first = () => screen.getAllByRole('listitem')[0]!;
    const last = () => screen.getAllByRole('listitem')[2]!;
    expect((within(first()).getByLabelText('Move up') as HTMLButtonElement).disabled).toBe(true);
    expect((within(last()).getByLabelText('Move down') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(first()).getByLabelText('Move down'));
    expect(names()[0]).toContain('Beta');
    expect(names()[1]).toContain('Alpha');
    fireEvent.click(within(screen.getAllByRole('listitem')[2]!).getByLabelText('Move up'));
    expect(names().map((n) => n.replace(/\d|Fallback|Disabled/g, ''))).toEqual([
      'Beta',
      'Direct',
      'Alpha',
    ]);
  });

  it('removes an item through its named remove button', () => {
    const onChange = vi.fn();
    render(ui(['a', 'b', 'direct'], onChange));
    fireEvent.click(screen.getByLabelText('Remove Beta'));
    expect(onChange).toHaveBeenCalledWith(['a', 'direct']);
    fireEvent.click(screen.getByLabelText('Remove Direct'));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('flags a disabled proxy in the chain and falls back to the id of an unknown one', () => {
    render(ui(['a', 'c', 'ghost']));
    const items = screen.getAllByRole('listitem');
    expect(within(items[1]!).getByText('Disabled')).toBeTruthy();
    expect(within(items[2]!).getByText('ghost')).toBeTruthy();
  });

  it('locks adding at 6 items and says so', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => proxyView({ id, name: id.toUpperCase() }));
    render(ui(['a', 'b', 'c', 'd', 'e', 'direct'], vi.fn(), many));
    expect((screen.getByLabelText('Proxy to add') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('A chain holds up to 6 items.')).toBeTruthy();
  });

  it('disables Add when every proxy and Direct are already in the chain', () => {
    render(ui(['a', 'b', 'direct'], vi.fn(), [alpha, beta]));
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with no proxy servers shows a link to create one instead of the picker', () => {
    render(ui([], vi.fn(), []));
    expect(screen.getByText(/No proxy servers yet\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add one' }).getAttribute('href')).toBe(
      '/proxy-servers/new',
    );
    expect(screen.queryByLabelText('Proxy to add')).toBeNull();
  });

  it('renders in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(ui(['a', 'b']));
    expect(screen.getByLabelText(t('proxies.binding.addLabel'))).toBeTruthy();
    expect(t('proxies.binding.addLabel')).not.toBe('Proxy to add');
    expect(screen.getAllByLabelText(t('proxies.binding.moveUp')).length).toBe(2);
    expect(t('proxies.binding.moveUp')).not.toBe('Move up');
    expect(screen.queryByLabelText('Move up')).toBeNull();
  });
});
