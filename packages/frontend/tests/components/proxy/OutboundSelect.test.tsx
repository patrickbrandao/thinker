import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OutboundSelect, {
  baseOutboundOptions,
  outboundIcon,
} from '../../../src/components/proxy/OutboundSelect';
import { resetLocaleForTests, t } from '../../../src/i18n';

const options = [
  { value: 'global', label: 'Global default' },
  { value: 'direct', label: 'Direct - no proxy' },
  { value: 'profile:p1', label: 'Profile: Primary' },
];

function setup(props: Partial<Parameters<typeof OutboundSelect>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <OutboundSelect
      label="Proxy mode"
      value="global"
      options={options}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe('baseOutboundOptions', () => {
  it('lists global, direct and one option per profile', () => {
    expect(baseOutboundOptions([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])).toEqual([
      { value: 'global', label: 'Global default' },
      { value: 'direct', label: 'Direct - no proxy' },
      { value: 'profile:a', label: 'Profile: A' },
      { value: 'profile:b', label: 'Profile: B' },
    ]);
  });
});

describe('outboundIcon', () => {
  it('returns an icon for every kind of value', () => {
    for (const v of ['direct', 'profile:x', 'inherit-provider', 'global', 'inherit']) {
      const { container, unmount } = render(<>{outboundIcon(v)}</>);
      expect(container.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });
});

describe('OutboundSelect', () => {
  it('shows the current option on the trigger and starts closed', () => {
    setup({ value: 'direct' });
    const trigger = screen.getByRole('button', { name: 'Proxy mode' });
    expect(trigger.textContent).toContain('Direct - no proxy');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with every option and marks the current one', () => {
    setup({ value: 'profile:p1' });
    fireEvent.click(screen.getByRole('button', { name: 'Proxy mode' }));
    expect(screen.getByRole('button', { name: 'Proxy mode' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(options.map((o) => o.label));
    expect(items[2]!.className).toContain('is-active');
    expect(items[0]!.className).not.toContain('is-active');
  });

  it('calls onChange for another option and closes, but ignores the current one', () => {
    const onChange = setup({ value: 'global' });
    fireEvent.click(screen.getByRole('button', { name: 'Proxy mode' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Global default' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Proxy mode' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile: Primary' }));
    expect(onChange).toHaveBeenCalledWith('profile:p1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Proxy mode' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('cannot be opened when disabled', () => {
    setup({ disabled: true });
    const trigger = screen.getByRole('button', { name: 'Proxy mode' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('falls back to the first option for an unknown value, and to a dash with no options', () => {
    setup({ value: 'profile:gone' });
    expect(screen.getByRole('button', { name: 'Proxy mode' }).textContent).toContain(
      'Global default',
    );
  });

  it('shows a dash when there are no options', () => {
    setup({ options: [], value: 'x' });
    expect(screen.getByRole('button', { name: 'Proxy mode' }).textContent).toContain('—');
  });

  it('uses iconFor to pick the icon of each option', () => {
    setup({ value: 'inherit', options: [{ value: 'inherit', label: 'Provider default' }], iconFor: () => 'direct' });
    expect(screen.getByRole('button', { name: 'Proxy mode' }).querySelector('svg')).toBeTruthy();
  });

  it('translates the base options to pt-BR', () => {
    resetLocaleForTests('pt-BR');
    const base = baseOutboundOptions([{ id: 'a', name: 'A' }]);
    expect(base[0]!.label).toBe(t('proxies.assignment.global'));
    expect(base[1]!.label).not.toBe('Direct - no proxy');
    expect(base[2]!.label).toContain('A');
  });
});
