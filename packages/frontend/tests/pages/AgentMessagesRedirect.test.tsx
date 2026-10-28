import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import AgentMessagesRedirect from '../../src/pages/AgentMessagesRedirect.jsx';

/** Where the redirect landed (pathname + search). */
function Landing() {
  const location = useLocation();
  return <div data-testid="navigate" data-href={`${location.pathname}${location.search}`} />;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/harnesses/:agentName/messages" element={<AgentMessagesRedirect />} />
        <Route path="/messages" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AgentMessagesRedirect', () => {
  it('redirects to the global log pre-scoped to the harness via ?agent=', () => {
    const { getByTestId } = renderAt('/harnesses/demo-agent/messages');
    expect(getByTestId('navigate').getAttribute('data-href')).toBe('/messages?agent=demo-agent');
  });

  it('URL-encodes the agent name', () => {
    const { getByTestId } = renderAt(`/harnesses/${encodeURIComponent('my agent/v2')}/messages`);
    expect(getByTestId('navigate').getAttribute('data-href')).toBe('/messages?agent=my+agent%2Fv2');
  });

  it('carries extra query params through (the ?request= drawer deep-link)', () => {
    const { getByTestId } = renderAt('/harnesses/demo-agent/messages?request=msg-1');
    expect(getByTestId('navigate').getAttribute('data-href')).toBe(
      '/messages?request=msg-1&agent=demo-agent',
    );
  });
});
