import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// `A` from the router is rendered as a plain anchor so hrefs are assertable.
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  Link: (props: any) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}));

import NoConnectionsPrompt from '../../src/components/NoConnectionsPrompt';

describe('NoConnectionsPrompt', () => {
  it('renders the Subscriptions and Usage-based provider cards', () => {
    const { container } = render(<NoConnectionsPrompt />);
    expect(container.querySelector('a[href="/providers/subscriptions/add"]')).not.toBeNull();
    expect(container.querySelector('a[href="/providers/usage-based/add"]')).not.toBeNull();
    expect(container.textContent).toContain('Subscriptions');
    expect(container.textContent).toContain('Usage-based');
  });

  it('always renders the Local provider card', () => {
    const { container } = render(<NoConnectionsPrompt />);
    const localCard = container.querySelector('a[href="/providers/local/add"]');
    expect(localCard).not.toBeNull();
    expect(localCard!.textContent).toContain('Local');
    expect(localCard!.textContent).toContain('Connect to LLM servers running on your machine.');
  });
});
