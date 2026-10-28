import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// The empty state renders NoConnectionsPrompt (the provider connection cards).
// That component belongs to another area of the React port and has its own
// tests, so it is stubbed here: this test only checks the delegation.
vi.mock('../../src/components/NoConnectionsPrompt.jsx', () => ({
  default: () => <div data-testid="no-connections">No providers connected</div>,
}));
import PlaygroundEmptyState from '../../src/components/playground/PlaygroundEmptyState';

describe('PlaygroundEmptyState', () => {
  it('renders the no-providers prompt with the provider connection cards', () => {
    // onConnect is still part of the contract but the prompt now routes via the
    // sidebar provider pages, so it is no longer invoked from here.
    const onConnect = vi.fn();
    const { container } = render(<PlaygroundEmptyState onConnect={onConnect} />);

    expect(container.querySelector('[data-testid="no-connections"]')).not.toBeNull();
    expect(container.textContent).toContain('No providers connected');
    expect(onConnect).not.toHaveBeenCalled();
  });
});
