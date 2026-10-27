import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import AuthLayout from '../../src/layouts/AuthLayout';

describe('AuthLayout', () => {
  it('renders children', () => {
    render(
      <AuthLayout>
        <span>Test child content</span>
      </AuthLayout>,
    );
    expect(screen.getByText('Test child content')).toBeDefined();
  });

  it('renders the nested route through the Outlet when used as a route layout', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<span>Login form</span>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Login form')).toBeDefined();
  });

  it('renders logo images', () => {
    const { container } = render(
      <AuthLayout>
        <span>Content</span>
      </AuthLayout>,
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(2);
  });

  it('shows the Thinker logo for both themes without linking off the instance', () => {
    const { container } = render(
      <AuthLayout>
        <span>Content</span>
      </AuthLayout>,
    );
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['/brand/thinker-logo.svg?v=1', '/brand/thinker-logo-dark.svg?v=1']);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Thinker');
    expect(container.querySelector('a')).toBeNull();
  });
});
