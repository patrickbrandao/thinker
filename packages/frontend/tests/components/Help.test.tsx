import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import Help from '../../src/pages/Help';

describe('Help', () => {
  it('shows Help & Support heading', () => {
    render(<Help />);
    expect(screen.getByRole('heading', { name: 'Help & Support' })).toBeTruthy();
  });

  it('renders Title metadata', () => {
    render(<Help />);
    // React 19 hoists <title> into document.head.
    expect(document.title).toContain('Help & Support - Thinker');
  });

  it('links the repository docs and issues, in a new tab', () => {
    render(<Help />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      'https://github.com/patrickbrandao/thinker/tree/main/docs',
      'https://github.com/patrickbrandao/thinker/issues',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('has no email support, call booking or Discussions link', () => {
    const { container } = render(<Help />);
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/manifest|calendly/i);
    expect(container.querySelector('a[href*="discussions"]')).toBeNull();
  });

  it('warns not to paste secrets into a public issue', () => {
    render(<Help />);
    expect(screen.getByText(/Leave out keys, tokens and request logs/)).toBeTruthy();
  });
});
