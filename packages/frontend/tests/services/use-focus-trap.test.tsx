import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../src/services/use-focus-trap.js';

let offsetParentDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom doesn't lay out the DOM, so offsetParent is always null. Patch the
  // prototype so every test element is considered visible, in case the trap
  // ever filters hidden nodes by offsetParent.
  offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(): HTMLElement | null {
      return document.body;
    },
  });
});

afterEach(() => {
  if (offsetParentDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor);
  }
});

interface TrapProps {
  open: boolean;
  initialFocus?: () => HTMLElement | undefined;
  children: ReactNode;
}

function Trap({ open, initialFocus, children }: TrapProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, { initialFocus: () => initialFocus?.() });
  return (
    <div ref={ref} data-testid="trap">
      {children}
    </div>
  );
}

function dispatchTab(target: HTMLElement, shift = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(ev);
  return ev;
}

describe('useFocusTrap', () => {
  it('is a no-op when open is false', () => {
    render(
      <Trap open={false}>
        <button id="b1">b1</button>
      </Trap>,
    );
    expect(document.activeElement?.id).not.toBe('b1');
  });

  it('focuses the first focusable child on open', () => {
    render(
      <Trap open={true}>
        <button id="b1">b1</button>
        <button id="b2">b2</button>
      </Trap>,
    );
    expect(document.activeElement?.id).toBe('b1');
  });

  it('does not move focus when there are no focusable children and no tabindex', () => {
    render(
      <Trap open={true}>
        <span>no buttons</span>
      </Trap>,
    );
    // Focus stays where it was — nothing inside the container can take it
    expect(document.activeElement?.tagName).not.toBe('SPAN');
  });

  it('uses options.initialFocus when provided', () => {
    let target: HTMLElement | undefined;
    render(
      <Trap open={true} initialFocus={() => target}>
        <button id="b1">b1</button>
        <button
          id="b2"
          ref={(el) => {
            target = el ?? undefined;
          }}
        >
          b2
        </button>
      </Trap>,
    );
    expect(document.activeElement?.id).toBe('b2');
  });

  it('wraps focus from the last element back to the first on Tab', () => {
    const { getByTestId } = render(
      <Trap open={true}>
        <button id="b1">b1</button>
        <button id="b2">b2</button>
      </Trap>,
    );
    (document.getElementById('b2') as HTMLElement).focus();
    const ev = dispatchTab(getByTestId('trap'));
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b1');
  });

  it('wraps focus from the first element back to the last on Shift+Tab', () => {
    const { getByTestId } = render(
      <Trap open={true}>
        <button id="b1">b1</button>
        <button id="b2">b2</button>
      </Trap>,
    );
    (document.getElementById('b1') as HTMLElement).focus();
    const ev = dispatchTab(getByTestId('trap'), true);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b2');
  });

  it('ignores non-Tab keypresses', () => {
    const { getByTestId } = render(
      <Trap open={true}>
        <button id="b1">b1</button>
        <button id="b2">b2</button>
      </Trap>,
    );
    (document.getElementById('b2') as HTMLElement).focus();
    getByTestId('trap').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(document.activeElement?.id).toBe('b2');
  });

  it('prevents the default Tab when there are no focusables left', () => {
    const { getByTestId } = render(
      <Trap open={true}>
        <span>no buttons</span>
      </Trap>,
    );
    const ev = dispatchTab(getByTestId('trap'));
    expect(ev.defaultPrevented).toBe(true);
  });

  it('restores focus to the previously-active element when the trap closes', () => {
    const opener = document.createElement('button');
    opener.id = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <Trap open={true}>
        <button id="b1">b1</button>
      </Trap>,
    );
    expect(document.activeElement?.id).toBe('b1');
    rerender(
      <Trap open={false}>
        <button id="b1">b1</button>
      </Trap>,
    );
    expect(document.activeElement?.id).toBe('opener');
  });
});
