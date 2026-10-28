import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import RootRedirect from '../../src/components/RootRedirect';

describe('RootRedirect', () => {
  it('redirects the root path to the global Overview', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/overview" element={<span>Overview page</span>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Overview page')).toBeDefined();
  });
});
