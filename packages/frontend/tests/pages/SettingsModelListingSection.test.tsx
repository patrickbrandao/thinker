import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../src/services/api.js', () => ({
  getModelListing: (...args: unknown[]) => mockGet(...args),
  updateModelListing: (...args: unknown[]) => mockUpdate(...args),
}));
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import SettingsModelListingSection from '../../src/pages/SettingsModelListingSection';

describe('SettingsModelListingSection', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue({ mode: 'open' });
    mockUpdate.mockImplementation((_a: string, mode: string) => Promise.resolve({ mode }));
  });

  it('shows the saved mode and saves a new one', async () => {
    render(() => <SettingsModelListingSection agentName={() => 'bot'} />);
    const select = (await screen.findByLabelText('Models in /v1/models')) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('open');
    fireEvent.change(select, { target: { value: 'restricted' } });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('bot', 'restricted'));
    await waitFor(() =>
      expect(screen.getByText(/the models they route and fall back to/)).toBeDefined(),
    );
  });
});
