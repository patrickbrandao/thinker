import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import AgentLimitsRedirect from '../../src/pages/AgentLimitsRedirect';
import AgentMessagesRedirect from '../../src/pages/AgentMessagesRedirect';

/** Where the redirect landed (pathname + search, as the URL holds them). */
function Landing() {
  const location = useLocation();
  return <div data-testid="navigate" data-href={`${location.pathname}${location.search}`} />;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/harnesses/:agentName/limits" element={<AgentLimitsRedirect />} />
        <Route path="/harnesses/:agentName/messages" element={<AgentMessagesRedirect />} />
        <Route path="/harnesses/:agentName/guardrails" element={<Landing />} />
        <Route path="/messages" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AgentLimitsRedirect', () => {
  it('redirects /limits to /guardrails for the current agent', () => {
    const { container } = renderAt('/harnesses/demo-agent/limits');
    const navigate = container.querySelector('[data-testid="navigate"]');
    expect(navigate).not.toBeNull();
    expect(navigate?.getAttribute('data-href')).toBe('/harnesses/demo-agent/guardrails');
  });

  it('encodes agent names with special characters correctly', () => {
    const { container } = renderAt('/harnesses/my%20agent/limits');
    const navigate = container.querySelector('[data-testid="navigate"]');
    expect(navigate?.getAttribute('data-href')).toBe('/harnesses/my%20agent/guardrails');
  });
});

describe('AgentMessagesRedirect', () => {
  it('redirects /harnesses/:name/messages to global /messages pre-filtered to the agent', () => {
    const { container } = renderAt('/harnesses/demo-agent/messages');
    const navigate = container.querySelector('[data-testid="navigate"]');
    expect(navigate).not.toBeNull();
    expect(navigate?.getAttribute('data-href')).toBe('/messages?agent=demo-agent');
  });

  it('encodes agent names with special characters correctly', () => {
    const { container } = renderAt('/harnesses/my agent/messages');
    const navigate = container.querySelector('[data-testid="navigate"]');
    expect(navigate?.getAttribute('data-href')).toBe('/messages?agent=my+agent');
  });

  it('normalizes an already-encoded route param instead of double-encoding', () => {
    const { container } = renderAt('/harnesses/my%20agent/messages');
    const navigate = container.querySelector('[data-testid="navigate"]');
    expect(navigate?.getAttribute('data-href')).toBe('/messages?agent=my+agent');
  });
});
