import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

let mockRules: any[] = [];
let mockRoutingStatus = { enabled: false };
let mockTriggers: any[] = [];
let mockBindings: any[] = [];

vi.mock('../../src/services/api.js', () => ({
  getNotificationRules: vi.fn(() => Promise.resolve(mockRules)),
  getNotificationLogs: vi.fn(() => Promise.resolve([])),
  createNotificationRule: vi.fn(() => Promise.resolve({})),
  updateNotificationRule: vi.fn(() => Promise.resolve({})),
  deleteNotificationRule: vi.fn(() => Promise.resolve({})),
  getRoutingStatus: vi.fn(() => Promise.resolve(mockRoutingStatus)),
}));

vi.mock('../../src/services/api/triggers.js', () => ({
  listTriggers: vi.fn(() => Promise.resolve(mockTriggers)),
  getHarnessTriggers: vi.fn(() => Promise.resolve(mockBindings)),
  setHarnessTriggers: vi.fn((_agent: string, bindings: any[]) => Promise.resolve(bindings)),
}));

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/components/LimitRuleModal.js', () => ({
  default: (props: any) => (
    <div
      data-testid="limit-modal"
      data-open={props.open}
      data-edit={!!props.editData}
      data-has-provider={String(props.hasProvider ?? '')}
    >
      LimitRuleModal
      <button
        data-testid="mock-save"
        onClick={() =>
          props.onSave({ metric_type: 'tokens', threshold: 100, period: 'day', action: 'notify' })
        }
      >
        Save
      </button>
      <button data-testid="mock-close" onClick={() => props.onClose()}>
        MockClose
      </button>
    </div>
  ),
}));

import Limits from '../../src/pages/Limits';

/** Limits reads :agentName from the route, so render it under one. */
function render(ui: () => React.ReactElement) {
  return rtlRender(
    <MemoryRouter initialEntries={['/harnesses/test-agent/guardrails']}>
      <Routes>
        <Route path="/harnesses/:agentName/guardrails" element={ui()} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Limits page', () => {
  beforeEach(() => {
    mockRules = [];
    mockRoutingStatus = { enabled: false };
    mockTriggers = [];
    mockBindings = [];
  });

  it('does not render a duplicate page heading', () => {
    const { container } = render(() => <Limits />);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('renders page description without duplicating the agent heading', () => {
    const { container } = render(() => <Limits />);
    expect(container.textContent).toContain(
      'Get notified or block requests when token or cost thresholds are exceeded',
    );
  });

  it('renders Create rule button', () => {
    render(() => <Limits />);
    expect(screen.getByText('Create rule')).toBeDefined();
  });

  it('renders empty state when no rules', async () => {
    render(() => <Limits />);
    await waitFor(() => {
      expect(screen.getByText('No rules yet')).toBeDefined();
    });
    expect(
      screen.getByText(
        'Set up alerts for usage spikes, or hard limits to block requests over budget.',
      ),
    ).toBeDefined();
  });

  it('renders rules table when rules exist', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 2,
        created_at: '2026-01-01',
      },
      {
        id: 'r2',
        agent_name: 'test-agent',
        metric_type: 'cost',
        threshold: 10,
        period: 'month',
        action: 'block',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-02',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.limit-type-icon').length).toBeGreaterThanOrEqual(2);
      expect(container.querySelectorAll('table tbody tr').length).toBe(2);
    });
  });

  it('shows Connect-provider CTA banner when no provider is active', async () => {
    mockRoutingStatus = { enabled: false };

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Connect a provider to set hard limits');
      expect(container.textContent).not.toContain('Enable routing to set hard limits');
    });
  });

  it('hides the CTA banner when a provider is already active', async () => {
    mockRoutingStatus = { enabled: true };

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('Connect a provider to set hard limits');
      expect(container.textContent).not.toContain('Enable routing to set hard limits');
    });
  });

  it('renders modal component', async () => {
    render(() => <Limits />);

    await vi.waitFor(() => {
      const modal = screen.getByTestId('limit-modal');
      expect(modal).toBeDefined();
    });
  });

  it('formats token threshold with locale string', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('50,000');
    });
  });

  it('formats cost threshold with dollar sign', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'cost',
        threshold: 10.5,
        period: 'month',
        action: 'block',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('$10.50');
    });
  });

  it('shows warning banner when block rules have been triggered', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'block',
        is_active: true,
        trigger_count: 3,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('One or more hard limits triggered');
    });
  });

  it('does not show warning banner when no block rules triggered', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 5,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('One or more hard limits triggered');
    });
  });

  it('does not show warning banner when block rules are inactive', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'block',
        is_active: false,
        trigger_count: 3,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('One or more hard limits triggered');
    });
  });

  it('renders merged threshold with period labels', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 100,
        period: 'hour',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
      {
        id: 'r2',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 200,
        period: 'week',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('per hour');
      expect(container.textContent).toContain('per week');
    });
  });

  it('shows disabled row style for inactive rules', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: false,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];
    const { container } = render(() => <Limits />);
    await vi.waitFor(() => {
      expect(container.querySelector('tr.is-off')).not.toBeNull();
    });
  });

  it('does not show disabled row for active rules', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];
    const { container } = render(() => <Limits />);
    await vi.waitFor(() => {
      expect(container.querySelector('tr.is-off')).toBeNull();
    });
  });

  it('renders kebab menu and defaults action to alert when not set', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        is_active: true,
        trigger_count: 7,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
      expect(container.querySelector('.limit-type-icon')).not.toBeNull();
      expect(container.textContent).toContain('7');
    });
  });

  it('shows both icons for rules with action both', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'both',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('.limit-type-icon').length).toBe(2);
    });
  });

  it('opens dropdown menu when kebab button is clicked', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    const { container } = render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));

    await vi.waitFor(() => {
      expect(document.querySelector('.rule-menu__dropdown')).not.toBeNull();
      expect(screen.getByText('Edit')).toBeDefined();
      expect(screen.getByText('Delete')).toBeDefined();
    });
  });

  it('opens delete confirmation modal with checkbox', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));

    await vi.waitFor(() => {
      expect(screen.getByText('Delete')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Delete'));

    await vi.waitFor(() => {
      const title = document.querySelector('.modal-head h2') as HTMLElement;
      expect(title.textContent).toBe('Delete rule');
      expect(screen.getByText('I understand this action is irreversible')).toBeDefined();

      const deleteBtn = document.querySelector('.btn-danger') as HTMLButtonElement;
      expect(deleteBtn.disabled).toBe(true);
    });
  });

  it('enables delete button only after confirmation checkbox', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));
    await vi.waitFor(() => expect(screen.getByText('Delete')).toBeDefined());
    fireEvent.click(screen.getByText('Delete'));

    await vi.waitFor(() => {
      expect(document.querySelector('.btn-danger')).not.toBeNull();
    });

    const checkbox = document.querySelector(
      '.modal label.check input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    await vi.waitFor(() => {
      const deleteBtn = document.querySelector('.btn-danger') as HTMLButtonElement;
      expect(deleteBtn.disabled).toBe(false);
    });
  });

  it('opens edit modal when Edit is clicked from kebab menu', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));
    await vi.waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
    fireEvent.click(screen.getByText('Edit'));

    await vi.waitFor(() => {
      const modal = screen.getByTestId('limit-modal');
      expect(modal.getAttribute('data-open')).toBe('true');
      expect(modal.getAttribute('data-edit')).toBe('true');
    });
  });

  // --- Delete rule modal content tests ---

  it("shows 'token' (singular) in delete modal for tokens metric type", async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));
    await vi.waitFor(() => expect(screen.getByText('Delete')).toBeDefined());
    fireEvent.click(screen.getByText('Delete'));

    await vi.waitFor(() => {
      const desc = document.querySelector('.modal-body p') as HTMLElement;
      expect(desc.textContent).toContain('tokens');
    });
  });

  it("shows 'cost' with formatted threshold in delete modal for cost metric type", async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'cost',
        threshold: 25.5,
        period: 'month',
        action: 'block',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));
    await vi.waitFor(() => expect(screen.getByText('Delete')).toBeDefined());
    fireEvent.click(screen.getByText('Delete'));

    await vi.waitFor(() => {
      const desc = document.querySelector('.modal-body p') as HTMLElement;
      expect(desc.textContent).toContain('cost');
      expect(desc.textContent).toContain('$25.50');
    });
  });

  it('closes delete modal when overlay is clicked', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));
    await vi.waitFor(() => expect(screen.getByText('Delete')).toBeDefined());
    fireEvent.click(screen.getByText('Delete'));

    await vi.waitFor(() => {
      expect(document.querySelector('.modal-head h2')).not.toBeNull();
    });

    // Click overlay to close (the backdrop closes on mousedown)
    const overlay = document.querySelector('.overlay') as HTMLElement;
    fireEvent.mouseDown(overlay);

    await vi.waitFor(() => {
      const titles = document.querySelectorAll('.modal-head h2');
      const deleteTitle = Array.from(titles).find((t) => t.textContent === 'Delete rule');
      expect(deleteTitle).toBeUndefined();
    });
  });

  it('closes delete modal when Cancel button is clicked', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Rule options')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Rule options'));
    await vi.waitFor(() => expect(screen.getByText('Delete')).toBeDefined());
    fireEvent.click(screen.getByText('Delete'));

    await vi.waitFor(() => {
      expect(document.querySelector('.modal-head h2')).not.toBeNull();
    });

    const cancelBtn = Array.from(document.querySelectorAll('.btn-ghost')).find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLButtonElement;
    fireEvent.click(cancelBtn);

    await vi.waitFor(() => {
      const titles = document.querySelectorAll('.modal-head h2');
      const deleteTitle = Array.from(titles).find((t) => t.textContent === 'Delete rule');
      expect(deleteTitle).toBeUndefined();
    });
  });

  it('resets editRule and closes modal on LimitRuleModal onClose', async () => {
    mockRules = [
      {
        id: 'r1',
        agent_name: 'test-agent',
        metric_type: 'tokens',
        threshold: 50000,
        period: 'day',
        action: 'notify',
        is_active: true,
        trigger_count: 0,
        created_at: '2026-01-01',
      },
    ];

    render(() => <Limits />);

    // Open the create rule modal
    fireEvent.click(screen.getByText('Create rule'));
    await vi.waitFor(() => {
      const modal = screen.getByTestId('limit-modal');
      expect(modal.getAttribute('data-open')).toBe('true');
    });

    // Close via the mocked close button
    fireEvent.click(screen.getByTestId('mock-close'));
    await vi.waitFor(() => {
      const modal = screen.getByTestId('limit-modal');
      expect(modal.getAttribute('data-open')).toBe('false');
    });
  });

  it('shows the trigger picker with a link to create one when the workspace has none', async () => {
    render(() => <Limits />);
    await waitFor(() => {
      expect(screen.getByText('No triggers in this workspace yet.')).toBeDefined();
    });
    expect(screen.getByText('Create a trigger').getAttribute('href')).toBe('/triggers');
  });

  it('tells the rule modal there is no delivery target without a limit.alert binding', async () => {
    mockTriggers = [{ id: 't1', name: 'ops', type: 'webhook', enabled: true }];
    mockBindings = [{ trigger_id: 't1', events: ['limit.block'] }];
    render(() => <Limits />);
    await waitFor(() => {
      expect(screen.getByTestId('limit-modal').getAttribute('data-has-provider')).toBe('false');
    });
  });

  it('tells the rule modal alerts are delivered with an enabled limit.alert binding', async () => {
    mockTriggers = [{ id: 't1', name: 'ops', type: 'webhook', enabled: true }];
    mockBindings = [{ trigger_id: 't1', events: ['limit.alert'] }];
    render(() => <Limits />);
    await screen.findByText('ops');
    expect(screen.getByTestId('limit-modal').getAttribute('data-has-provider')).toBe('true');
  });
});
