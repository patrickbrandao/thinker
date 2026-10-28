import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import NotFound from '../../src/pages/NotFound';

function renderPage() {
  return render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
}

describe('NotFound', () => {
  it('shows 404 code', () => {
    renderPage();
    expect(screen.getByText('404')).toBeDefined();
  });

  it('shows page not found heading', () => {
    renderPage();
    expect(screen.getByText('Page not found')).toBeDefined();
  });

  it('shows description text', () => {
    renderPage();
    expect(screen.getByText(/doesn't exist or has been moved/)).toBeDefined();
  });

  it('has a link back to dashboard', () => {
    renderPage();
    const link = screen.getByText('Back to dashboard').closest('a');
    expect(link?.getAttribute('href')).toBe('/');
  });
});
