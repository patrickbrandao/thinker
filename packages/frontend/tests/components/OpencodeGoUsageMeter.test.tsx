import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getUsage = vi.fn();
vi.mock('../../src/services/api/oauth.js', () => ({
  getOpencodeGoUsage: (...args: unknown[]) => getUsage(...args),
}));

import OpencodeGoUsageMeter from '../../src/components/OpencodeGoUsageMeter';

describe('OpencodeGoUsageMeter', () => {
  beforeEach(() => getUsage.mockReset());

  it('shows each allowance window with its share spent', async () => {
    getUsage.mockResolvedValue({
      usage: {
        rolling: { percent: 12.4, limited: false, resetsAt: null },
        weekly: { percent: 100, limited: true, resetsAt: null },
        monthly: null,
      },
    });
    render(<OpencodeGoUsageMeter agentName="agent" />);
    await waitFor(() => expect(screen.getByText('12%')).toBeTruthy());
    expect(getUsage).toHaveBeenCalledWith('agent');
    expect(screen.getByText('Limit reached')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('renders nothing when the connection has no meter', async () => {
    getUsage.mockResolvedValue({ usage: null });
    const { container } = render(<OpencodeGoUsageMeter agentName="agent" />);
    await waitFor(() => expect(getUsage).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
