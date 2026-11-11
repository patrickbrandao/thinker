import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  FloatingWindow,
  WindowFooter,
  IconButton,
  Kbd,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  Modal,
  Panel,
  Skel,
  Status,
  Switch,
  Tabs,
  cx,
  useClickOutside,
} from '../../src/components/ui';
import { resetLocaleForTests } from '../../src/i18n';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('cx', () => {
  it('joins truthy parts and skips falsy ones', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cx()).toBe('');
    expect(cx(false, null)).toBe('');
  });
});

describe('Button', () => {
  it('defaults to type=button so it never submits a surrounding form', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
      </form>,
    );
    const btn = screen.getByRole('button', { name: 'Plain' });
    expect(btn.getAttribute('type')).toBe('button');
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits when type=submit', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Go</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('maps variant, size and block to classes (primary/md are the base)', () => {
    const { rerender } = render(<Button>x</Button>);
    expect(screen.getByRole('button').className).toBe('btn');
    rerender(
      <Button variant="danger" size="sm" block className="extra">
        x
      </Button>,
    );
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('btn-danger');
    expect(cls).toContain('btn-sm');
    expect(cls).toContain('btn-block');
    expect(cls).toContain('extra');
  });

  it('is disabled and aria-busy while busy, with a hidden spinner, and does not fire onClick', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.spinner')!.getAttribute('aria-hidden')).toBe('true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not set aria-busy when idle', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
  });

  it('respects disabled and activates with the keyboard when enabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Button onClick={onClick}>Run</Button>);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
    rerender(
      <Button disabled onClick={onClick}>
        Run
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe('ButtonLink', () => {
  it('renders a router link with button classes', () => {
    wrap(
      <ButtonLink to="/x" variant="ghost" size="lg" block>
        Open
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe('/x');
    expect(link.className).toContain('btn-ghost');
    expect(link.className).toContain('btn-lg');
    expect(link.className).toContain('btn-block');
  });
});

describe('IconButton', () => {
  it('uses label as accessible name and tooltip', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Delete" onClick={onClick}>
        <svg />
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.getAttribute('title')).toBe('Delete');
    expect(btn.getAttribute('type')).toBe('button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Panel', () => {
  it('renders a section with heading, actions and body', () => {
    render(
      <Panel title="Stats" icon={<i data-testid="ic" />} actions={<button>Act</button>}>
        body
      </Panel>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Stats' })).toBeTruthy();
    expect(screen.getByTestId('ic')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Act' })).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('omits the header entirely without title or actions', () => {
    const { container } = render(<Panel>only body</Panel>);
    expect(container.querySelector('.panel-head')).toBeNull();
    expect(container.querySelector('.panel-body')!.textContent).toBe('only body');
  });

  it('keeps an empty title slot when only actions are given', () => {
    const { container } = render(<Panel actions={<button>Act</button>}>b</Panel>);
    expect(container.querySelector('.panel-head h2')).toBeNull();
    expect(screen.getByRole('button', { name: 'Act' })).toBeTruthy();
  });
});

describe('Field', () => {
  it('associates the label with its control', () => {
    render(
      <Field label="Name" htmlFor="n" hint="Pick one">
        <input id="n" />
      </Field>,
    );
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByText('Pick one')).toBeTruthy();
  });

  it('shows the error instead of the hint', () => {
    render(
      <Field label="Name" hint="Pick one" error="Required">
        <input />
      </Field>,
    );
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.queryByText('Pick one')).toBeNull();
  });

  it('renders neither when none is given', () => {
    const { container } = render(
      <Field label="Name">
        <input />
      </Field>,
    );
    expect(container.querySelector('.hint')).toBeNull();
  });
});

describe('Badge / Status / small primitives', () => {
  it('Badge maps tone, mono and title', () => {
    const { rerender } = render(<Badge>n</Badge>);
    expect(screen.getByText('n').className).toBe('badge');
    rerender(
      <Badge tone="warn" mono title="why">
        n
      </Badge>,
    );
    const el = screen.getByText('n');
    expect(el.className).toContain('is-warn');
    expect(el.className).toContain('mono');
    expect(el.getAttribute('title')).toBe('why');
  });

  it('Status maps tone and pulse (off is the base)', () => {
    const { rerender } = render(<Status>idle</Status>);
    expect(screen.getByText('idle').className).toBe('status');
    rerender(
      <Status tone="ok" pulse>
        live
      </Status>,
    );
    expect(screen.getByText('live').className).toBe('status is-ok is-pulse');
  });

  it('Kbd renders a kbd element', () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc').tagName).toBe('KBD');
  });

  it('Skel is hidden from assistive tech and sized', () => {
    const { container } = render(<Skel width={40} height="1rem" />);
    const el = container.querySelector('.skel') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('40px');
    expect(el.style.height).toBe('1rem');
  });

  it('Avatar shows the first initial, or ? for empty names', () => {
    const { rerender, container } = render(<Avatar name="  patrick" />);
    expect(container.textContent).toBe('p');
    rerender(<Avatar name="" />);
    expect(container.textContent).toBe('?');
    rerender(<Avatar name={null} />);
    expect(container.textContent).toBe('?');
    rerender(<Avatar name="   " />);
    expect(container.textContent).toBe('?');
    expect(container.querySelector('.avatar')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('EmptyState renders title, optional description and action', () => {
    const { rerender } = render(<EmptyState title="Nothing" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing' })).toBeTruthy();
    expect(document.querySelector('.empty p')).toBeNull();
    rerender(
      <EmptyState
        icon={<i data-testid="i" />}
        title="Nothing"
        description="Add one"
        action={<button>Add</button>}
      />,
    );
    expect(screen.getByText('Add one')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.getByTestId('i')).toBeTruthy();
  });
});

describe('Switch', () => {
  it('exposes role=switch with aria-checked and toggles to the opposite value', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Enable" />);
    const sw = screen.getByRole('switch', { name: 'Enable' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<Switch checked onChange={onChange} label="Enable" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('is operable by keyboard and inert when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Enable" />);
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(<Switch checked={false} onChange={onChange} label="Enable" disabled />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Tabs', () => {
  it('renders a tablist with the active tab selected and fires onChange', async () => {
    const onChange = vi.fn();
    wrap(
      <Tabs
        label="Sections"
        value="b"
        onChange={onChange}
        items={[
          { key: 'a', label: 'Alpha', count: 3 },
          { key: 'b', label: 'Beta' },
        ]}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    expect(alpha.getAttribute('aria-selected')).toBe('false');
    expect(alpha.querySelector('.count')!.textContent).toBe('3');
    await userEvent.click(alpha);
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('renders items with `to` as links', () => {
    wrap(
      <Tabs
        value="a"
        items={[
          { key: 'a', label: 'Alpha', to: '/a' },
          { key: 'b', label: 'Beta', to: '/b' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('href')).toBe('/b');
    expect(screen.getByRole('tab', { name: 'Alpha' }).className).toContain('is-active');
  });

  it('a button tab without onChange does not throw', async () => {
    wrap(<Tabs value="a" items={[{ key: 'a', label: 'Alpha' }]} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
  });

  it('shows a zero count (0 is not hidden)', () => {
    wrap(<Tabs value="a" items={[{ key: 'a', label: 'Alpha', count: 0 }]} />);
    expect(screen.getByRole('tab').querySelector('.count')!.textContent).toBe('0');
  });
});

describe('useClickOutside', () => {
  function Probe({ open, onClose }: { open: boolean; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useClickOutside(ref, open, onClose);
    return (
      <div>
        <div ref={ref} data-testid="inside">
          in
        </div>
        <button>outside</button>
      </div>
    );
  }

  it('closes on an outside pointerdown and on Escape, not on an inside pointerdown', () => {
    const onClose = vi.fn();
    render(<Probe open onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('listens to nothing while closed', () => {
    const onClose = vi.fn();
    render(<Probe open={false} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes its listeners on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Probe open onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Menu', () => {
  function Demo({ onSelect = vi.fn() }: { onSelect?: () => void }) {
    return (
      <MemoryRouter>
        <Menu
          label="Actions"
          align="right"
          trigger={(p) => (
            <button {...p} data-testid="trigger">
              Open
            </button>
          )}
        >
          <MenuHeading>Group</MenuHeading>
          <MenuItem onSelect={onSelect}>Rename</MenuItem>
          <MenuSeparator />
          <MenuItem danger meta="⌘D" onSelect={onSelect}>
            Delete
          </MenuItem>
          <MenuItem to="/go">Go</MenuItem>
          <MenuItem href="https://example.com/docs">Docs</MenuItem>
        </Menu>
      </MemoryRouter>
    );
  }

  it('is closed by default and wires aria-haspopup / aria-expanded / aria-controls', () => {
    render(<Demo />);
    const trigger = screen.getByTestId('trigger');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
  });

  it('runs onSelect and closes after choosing an item', () => {
    const onSelect = vi.fn();
    render(<Demo onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on an outside click', () => {
    render(<Demo />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('toggles closed when the trigger is clicked again', () => {
    render(<Demo />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders danger style, meta, separator, heading, router link and external link', () => {
    render(<Demo />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('menuitem', { name: /Delete/ }).className).toContain('is-danger');
    expect(screen.getByText('⌘D')).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByText('Group')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Go' }).getAttribute('href')).toBe('/go');
    const docs = screen.getByRole('menuitem', { name: 'Docs' });
    expect(docs.getAttribute('target')).toBe('_blank');
    expect(docs.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('supports render-prop children that receive close()', () => {
    render(
      <Menu
        up
        trigger={(p) => (
          <button {...p} data-testid="t">
            Open
          </button>
        )}
      >
        {(close) => <button onClick={close}>Close me</button>}
      </Menu>,
    );
    fireEvent.click(screen.getByTestId('t'));
    expect((screen.getByRole('menu') as HTMLElement).style.bottom).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Close me' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('MenuItem marks the active entry', () => {
    render(
      <MenuItem active onSelect={() => {}}>
        Current
      </MenuItem>,
    );
    expect(screen.getByRole('menuitem').className).toContain('is-active');
  });
});

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} title="T" onClose={() => {}}>
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an accessible modal dialog in a portal, named after its title', () => {
    render(
      <Modal open title="Confirm" onClose={() => {}}>
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('prefers an explicit label over a string title, and tolerates a node title', () => {
    const { rerender } = render(
      <Modal open title="Confirm" label="Custom label" onClose={() => {}}>
        b
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Custom label' })).toBeTruthy();
    rerender(
      <Modal open title={<b>Node</b>} onClose={() => {}}>
        b
      </Modal>,
    );
    expect(screen.getByRole('dialog').hasAttribute('aria-label')).toBe(false);
  });

  it('has no header (and no close X) without a title', () => {
    render(
      <Modal open label="Bare" onClose={() => {}}>
        b
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('closes via Escape, the X button and a backdrop click, but not an inner click', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="T" onClose={onClose} wide>
        <p>inner</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog').className).toContain('wide');
    fireEvent.mouseDown(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(document.querySelector('.overlay')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('close button is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(
      <Modal open title="T" onClose={() => {}}>
        b
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
  });

  it('stops listening to Escape after it is closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open title="T" onClose={onClose}>
        b
      </Modal>,
    );
    rerender(
      <Modal open={false} title="T" onClose={onClose}>
        b
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FloatingWindow', () => {
  function stubRect() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 300,
      height: 200,
      right: 400,
      bottom: 300,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    (HTMLElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture =
      vi.fn();
  }

  it('renders a non-modal dialog with title, body, icon and footer', () => {
    render(
      <FloatingWindow
        open
        title="Inspector"
        icon={<i data-testid="ic" />}
        onClose={() => {}}
        footer={<span>foot</span>}
      >
        content
      </FloatingWindow>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Inspector' });
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(screen.getByTestId('ic')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
    expect(screen.getByText('foot')).toBeTruthy();
  });

  it('renders nothing when closed and omits the footer when absent', () => {
    const { rerender } = render(
      <FloatingWindow open={false} title="W" onClose={() => {}}>
        c
      </FloatingWindow>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <FloatingWindow open title="W" onClose={() => {}}>
        c
      </FloatingWindow>,
    );
    // The footer slot stays empty (hidden by CSS :empty) when nothing fills it.
    expect(document.querySelector('.floating-window-foot')?.childNodes.length).toBe(0);
  });

  it('moves a WindowFooter into the fixed footer, outside the scrolling body', () => {
    render(
      <FloatingWindow open title="W" onClose={() => {}}>
        <p>content</p>
        <WindowFooter>
          <button type="button">Save</button>
        </WindowFooter>
      </FloatingWindow>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.closest('.floating-window-foot')).toBeTruthy();
    expect(save.closest('.floating-window-body')).toBeNull();
  });

  it('renders a WindowFooter in place outside a window', () => {
    render(
      <div data-testid="host">
        <WindowFooter>
          <button type="button">Save</button>
        </WindowFooter>
      </div>,
    );
    expect(screen.getByTestId('host').contains(screen.getByRole('button', { name: 'Save' }))).toBe(
      true,
    );
  });

  it('closes with the X and with Escape; an outside click does not close it', () => {
    const onClose = vi.fn();
    render(
      <FloatingWindow open title="W" onClose={onClose}>
        c
      </FloatingWindow>,
    );
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('drags by the title bar and clamps so the bar stays on screen', () => {
    stubRect();
    render(
      <FloatingWindow open title="W" onClose={() => {}}>
        c
      </FloatingWindow>,
    );
    const head = document.querySelector('.floating-window-head') as HTMLElement;
    const win = screen.getByRole('dialog');
    fireEvent.pointerDown(head, { clientX: 150, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 250, clientY: 160, pointerId: 1 });
    expect(win.style.left).toBe('200px');
    expect(win.style.top).toBe('150px');
    // Far past the left/top edge clamps to 0.
    fireEvent.pointerMove(head, { clientX: -900, clientY: -900, pointerId: 1 });
    expect(win.style.left).toBe('0px');
    expect(win.style.top).toBe('0px');
    // Far past the bottom/right clamps to keep the bar reachable.
    fireEvent.pointerMove(head, { clientX: 99999, clientY: 99999, pointerId: 1 });
    expect(win.style.left).toBe(`${window.innerWidth - 300}px`);
    expect(win.style.top).toBe(`${window.innerHeight - 48}px`);
    // After release, moves are ignored.
    fireEvent.pointerUp(head, { pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(win.style.left).toBe(`${window.innerWidth - 300}px`);
    vi.restoreAllMocks();
  });

  it('does not start a drag from the close button', () => {
    stubRect();
    render(
      <FloatingWindow open title="W" onClose={() => {}}>
        c
      </FloatingWindow>,
    );
    const head = document.querySelector('.floating-window-head') as HTMLElement;
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Close' }), {
      clientX: 150,
      clientY: 110,
      pointerId: 1,
    });
    fireEvent.pointerMove(head, { clientX: 250, clientY: 160, pointerId: 1 });
    expect(screen.getByRole('dialog').getAttribute('style') ?? '').not.toContain('left');
    vi.restoreAllMocks();
  });

  it('resets its position when reopened', () => {
    stubRect();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <FloatingWindow open={open} title="W" onClose={() => {}}>
            c
          </FloatingWindow>
        </>
      );
    }
    render(<Host />);
    const head = document.querySelector('.floating-window-head') as HTMLElement;
    fireEvent.pointerDown(head, { clientX: 150, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 250, clientY: 160, pointerId: 1 });
    expect(screen.getByRole('dialog').style.left).toBe('200px');
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByRole('dialog').style.left).toBe('');
    vi.restoreAllMocks();
  });
});
