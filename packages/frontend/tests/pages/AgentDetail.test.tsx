import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

let mockPlatformIcon: string | undefined = undefined;
vi.mock('../../src/services/agent-platform-store.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return {
    agentPlatformSignal: signal({ platform: null, category: null }),
    agentPlatformIcon: () => mockPlatformIcon,
  };
});

// Default: no resolved display name (falls back to decoded slug)
let mockAgentDisplayName: string | null = null;
vi.mock('../../src/services/agent-display-name.js', async () => {
  const { signal } = await import('../../src/lib/signal');
  return {
    agentDisplayNameSignal: signal(null),
    agentDisplayName: () => mockAgentDisplayName,
  };
});

import AgentDetail from '../../src/pages/AgentDetail';

/** AgentDetail is a route layout: tab content arrives through <Outlet />. */
function renderAt(pathname: string, child: ReactElement | null = null) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/harnesses/:agentName" element={<AgentDetail />}>
          <Route index element={child} />
          <Route path="*" element={child} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const tabsOf = (container: HTMLElement) =>
  container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLAnchorElement>;

describe('AgentDetail', () => {
  beforeEach(() => {
    mockAgentDisplayName = null;
    mockPlatformIcon = undefined;
  });

  it('renders the page title with the agent name', () => {
    renderAt('/harnesses/my-agent');
    expect(document.title).toBe('my-agent | Thinker');
  });

  it('renders a back-link to /harnesses', () => {
    const { container } = renderAt('/harnesses/my-agent');
    const backLink = container.querySelector('a[href="/harnesses"]') as HTMLAnchorElement;
    expect(backLink).not.toBeNull();
    expect(backLink.textContent).toContain('Harnesses');
  });

  it('renders an H1 with the agent name', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('my-agent');
  });

  it('renders a tablist with exactly 6 tabs', () => {
    const { container } = renderAt('/harnesses/my-agent');
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist!.querySelectorAll('[role="tab"]').length).toBe(6);
  });

  it('renders tabs labeled Overview, Routing, Models, Providers, Limits, Settings in order', () => {
    const { container } = renderAt('/harnesses/my-agent');
    const labels = Array.from(tabsOf(container)).map((t) => t.textContent);
    expect(labels).toEqual(['Overview', 'Routing', 'Models', 'Providers', 'Limits', 'Settings']);
  });

  it('Overview tab links to the agent root path', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(tabsOf(container)[0].getAttribute('href')).toBe('/harnesses/my-agent');
  });

  it('Routing tab links to /harnesses/:name/routing', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(tabsOf(container)[1].getAttribute('href')).toBe('/harnesses/my-agent/routing');
  });

  it('Models tab links to /harnesses/:name/models', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(tabsOf(container)[2].getAttribute('href')).toBe('/harnesses/my-agent/models');
  });

  it('Providers tab links to /harnesses/:name/providers', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(tabsOf(container)[3].getAttribute('href')).toBe('/harnesses/my-agent/providers');
  });

  it('Limits tab links to /harnesses/:name/guardrails', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(tabsOf(container)[4].getAttribute('href')).toBe('/harnesses/my-agent/guardrails');
  });

  it('Settings tab links to /harnesses/:name/settings', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(tabsOf(container)[5].getAttribute('href')).toBe('/harnesses/my-agent/settings');
  });

  it('marks Overview tab active when pathname is the agent root', () => {
    const { container } = renderAt('/harnesses/my-agent');
    const tabs = tabsOf(container);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');
    expect(tabs[3].getAttribute('aria-selected')).toBe('false');
    expect(tabs[4].getAttribute('aria-selected')).toBe('false');
    expect(tabs[5].getAttribute('aria-selected')).toBe('false');
  });

  it('marks Overview tab active when pathname is /overview', () => {
    const { container } = renderAt('/harnesses/my-agent/overview');
    expect(tabsOf(container)[0].getAttribute('aria-selected')).toBe('true');
  });

  it('marks Routing tab active when pathname is /routing', () => {
    const { container } = renderAt('/harnesses/my-agent/routing');
    const tabs = tabsOf(container);
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('marks Models tab active when pathname is /models', () => {
    const { container } = renderAt('/harnesses/my-agent/models');
    expect(tabsOf(container)[2].getAttribute('aria-selected')).toBe('true');
  });

  it('marks Limits tab active when pathname is /guardrails', () => {
    const { container } = renderAt('/harnesses/my-agent/guardrails');
    expect(tabsOf(container)[4].getAttribute('aria-selected')).toBe('true');
  });

  it('marks Providers tab active when pathname is /providers', () => {
    const { container } = renderAt('/harnesses/my-agent/providers');
    expect(tabsOf(container)[3].getAttribute('aria-selected')).toBe('true');
  });

  it('marks Settings tab active when pathname starts with /settings', () => {
    const { container } = renderAt('/harnesses/my-agent/settings/advanced');
    expect(tabsOf(container)[5].getAttribute('aria-selected')).toBe('true');
  });

  it('renders the nested route inside the shell', () => {
    const { container } = renderAt(
      '/harnesses/my-agent',
      <div data-testid="child-content">Tab content</div>,
    );
    expect(container.querySelector('[data-testid="child-content"]')).not.toBeNull();
  });

  it('decodes URL-encoded agent names in title', () => {
    const { container } = renderAt('/harnesses/my%20agent');
    expect(document.title).toBe('my agent | Thinker');
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('my agent');
  });

  it('does not show platform icon when agentPlatformIcon returns undefined', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(container.querySelector('img')).toBeNull();
  });

  it('applies the is-active class to the active tab', () => {
    const { container } = renderAt('/harnesses/my-agent/routing');
    const tabs = tabsOf(container);
    expect(tabs[1].className).toContain('is-active');
    expect(tabs[0].className).not.toContain('is-active');
  });

  it('uses resolved display name in title when agentDisplayName is set', () => {
    mockAgentDisplayName = 'My Cool Agent';
    renderAt('/harnesses/my-agent');
    expect(document.title).toBe('My Cool Agent | Thinker');
  });

  it('renders the H1 with the display name when agentDisplayName is set', () => {
    mockAgentDisplayName = 'My Cool Agent';
    const { container } = renderAt('/harnesses/my-agent');
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('My Cool Agent');
  });

  it('falls back to decoded slug in title when agentDisplayName is null', () => {
    renderAt('/harnesses/my-agent');
    expect(document.title).toBe('my-agent | Thinker');
  });

  it('renders the H1 with the decoded slug when agentDisplayName is null', () => {
    const { container } = renderAt('/harnesses/my-agent');
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('my-agent');
  });
});

describe('AgentDetail with platform icon', () => {
  it('renders the platform icon and H1 when agentPlatformIcon is set', () => {
    mockPlatformIcon = '/icons/robot.svg';
    mockAgentDisplayName = null;
    const { container } = renderAt('/harnesses/my-agent');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/icons/robot.svg');
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('my-agent');
  });
});
