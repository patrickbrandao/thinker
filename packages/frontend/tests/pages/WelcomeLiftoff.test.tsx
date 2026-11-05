import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { resetLocaleForTests } from '../../src/i18n';

const stop = vi.fn();
const animate = vi.hoisted(() => vi.fn());
vi.mock('motion', () => ({ animate }));

import WelcomeLiftoff from '../../src/pages/WelcomeLiftoff';

let rafQueue: Array<() => void> = [];
let reducedMotion = false;

beforeEach(() => {
  vi.clearAllMocks();
  animate.mockReturnValue({ stop });
  rafQueue = [];
  reducedMotion = false;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as never;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flushFrame = () => rafQueue.splice(0).forEach((cb) => cb());

describe('WelcomeLiftoff', () => {
  it('is an accessible modal dialog labelled by its title and description', () => {
    render(<WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('welcome-liftoff-title');
    expect(document.getElementById('welcome-liftoff-title')!.textContent).toBe('Orbit achieved');
    expect(document.getElementById('welcome-liftoff-description')!.textContent).toContain(
      "Your agent's first request just came through.",
    );
    expect(screen.getByText('Onboarding complete')).toBeTruthy();
    expect(screen.getByText('Liftoff')).toBeTruthy();
  });

  it('mentions the model and latency of the first request when known', () => {
    render(
      <WelcomeLiftoff
        latestAgentRequest={{ status: 'success', model: 'gpt-5.5', duration_ms: 842 }}
        harnessSlug="h"
        onLeave={() => {}}
      />,
    );
    const text = document.getElementById('welcome-liftoff-description')!.textContent!;
    expect(text).toContain('Routed to gpt-5.5');
    expect(text).toContain('in 842 ms');
    expect(text.endsWith('.')).toBe(true);
  });

  it('omits the latency when the duration is missing or zero, and everything without a model', () => {
    const { rerender } = render(
      <WelcomeLiftoff
        latestAgentRequest={{ status: 'success', model: 'gpt-5.5', duration_ms: 0 }}
        harnessSlug="h"
        onLeave={() => {}}
      />,
    );
    let text = document.getElementById('welcome-liftoff-description')!.textContent!;
    expect(text).toContain('Routed to gpt-5.5');
    expect(text).not.toContain(' ms');
    rerender(
      <WelcomeLiftoff
        latestAgentRequest={{ status: 'success' }}
        harnessSlug="h"
        onLeave={() => {}}
      />,
    );
    text = document.getElementById('welcome-liftoff-description')!.textContent!;
    expect(text).not.toContain('Routed to');
  });

  it('labels the live status with the harness slug, or "agent" without one', () => {
    const { rerender } = render(
      <WelcomeLiftoff latestAgentRequest={null} harnessSlug="my-harness" onLeave={() => {}} />,
    );
    expect(screen.getByText('my-harness · live')).toBeTruthy();
    rerender(<WelcomeLiftoff latestAgentRequest={null} harnessSlug="" onLeave={() => {}} />);
    expect(screen.getByText('agent · live')).toBeTruthy();
  });

  it('leaves for the dashboard from the button', () => {
    const onLeave = vi.fn();
    render(<WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={onLeave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to dashboard' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('plays the animation sequence on the next frame', async () => {
    render(<WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={() => {}} />);
    expect(animate).not.toHaveBeenCalled();
    flushFrame();
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(1));
    const sequence = animate.mock.calls[0][0] as Array<[HTMLElement, object, { at: number }]>;
    expect(sequence.length).toBeGreaterThan(10);
    // Every step animates a real element of the scene.
    for (const [el] of sequence) expect(el).toBeInstanceOf(Element);
  });

  it('stops the animation when unmounted', async () => {
    const { unmount } = render(
      <WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={() => {}} />,
    );
    flushFrame();
    await waitFor(() => expect(animate).toHaveBeenCalled());
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('does not start the animation when unmounted before its frame', async () => {
    const { unmount } = render(
      <WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={() => {}} />,
    );
    unmount();
    flushFrame();
    await new Promise((r) => setTimeout(r, 0));
    expect(animate).not.toHaveBeenCalled();
  });

  it('skips the animation under reduced motion and shows the end state', () => {
    reducedMotion = true;
    render(<WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={() => {}} />);
    expect(rafQueue).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').style.opacity).toBe('1');
    expect(document.getElementById('welcome-liftoff-title')!.style.opacity).toBe('1');
    expect(
      screen.getByRole('button', { name: 'Go to dashboard' }).parentElement!.style.opacity,
    ).toBe('1');
  });

  it('is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<WelcomeLiftoff latestAgentRequest={null} harnessSlug="h" onLeave={() => {}} />);
    expect(screen.queryByText('Orbit achieved')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to dashboard' })).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
