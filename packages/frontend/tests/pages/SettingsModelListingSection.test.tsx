import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../src/services/api', () => ({
  getModelListing: (...args: unknown[]) => mockGet(...args),
  updateModelListing: (...args: unknown[]) => mockUpdate(...args),
}));
vi.mock('../../src/services/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import SettingsModelListingSection from '../../src/pages/SettingsModelListingSection';

describe('SettingsModelListingSection', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue({ mode: 'open' });
    mockUpdate.mockImplementation((_a: string, mode: string) => Promise.resolve({ mode }));
  });

  it('shows the saved mode and saves a new one', async () => {
    render(<SettingsModelListingSection agentName="bot" />);
    const select = (await screen.findByLabelText('Models in /v1/models')) as HTMLButtonElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.textContent).toContain('Open');
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: 'Restricted' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('bot', 'restricted'));
    await waitFor(() =>
      expect(screen.getByText(/the models they route and fall back to/)).toBeDefined(),
    );
  });
});
