import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const getProviderModels = vi.fn();
vi.mock('../../../src/services/api/provider-models.js', () => ({
  getProviderModels: (...args: unknown[]) => getProviderModels(...args),
}));
vi.mock('../../../src/services/api/routing.js', () => ({ refreshConnectionModels: vi.fn() }));

import ConnectionModels from '../../../src/pages/providers/ConnectionModels';

describe('ConnectionModels', () => {
  it('refetches the account models when reloadKey changes', async () => {
    getProviderModels.mockResolvedValue({ models: [] });
    const { rerender } = render(<ConnectionModels connectionId="c1" canRefresh={false} />);
    await waitFor(() => expect(getProviderModels).toHaveBeenCalledTimes(1));
    rerender(<ConnectionModels connectionId="c1" canRefresh={false} reloadKey={1} />);
    await waitFor(() => expect(getProviderModels).toHaveBeenCalledTimes(2));
  });
});
