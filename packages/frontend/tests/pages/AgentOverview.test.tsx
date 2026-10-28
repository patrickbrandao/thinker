import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// AgentOverview is the canonical name for the agent-scoped overview page.
// It re-exports Overview, so we verify the rename doesn't break rendering.
// Overview itself is mocked here to avoid the full dependency tree; the
// comprehensive behavioral tests live in Overview.test.tsx.

// Mock the Overview module that AgentOverview re-exports.
// This prevents the deep dependency chain (which requires thinker-shared to be
// built) from being triggered in tests. Behavioral coverage is in Overview.test.tsx.
vi.mock('../../src/pages/Overview.js', () => ({
  default: () => <div data-testid="overview-stub">AgentOverview content</div>,
}));

import AgentOverview from '../../src/pages/AgentOverview';

describe('AgentOverview', () => {
  it('renders the component provided by the re-export', () => {
    const { container } = render(<AgentOverview />);
    expect(container.querySelector('[data-testid="overview-stub"]')).not.toBeNull();
  });

  it('has the same default export as Overview', async () => {
    const { default: AgentOverviewExport } = await import('../../src/pages/AgentOverview');
    const { default: OverviewExport } = await import('../../src/pages/Overview');
    // Both modules export the same component (the re-export works correctly).
    expect(AgentOverviewExport).toBe(OverviewExport);
  });
});
