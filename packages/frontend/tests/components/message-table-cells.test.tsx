import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  FallbackIcon,
  HeartbeatIcon,
  ModelCell,
  AgentCell,
  StatusCell,
  statusShape,
  AttemptsCell,
} from '../../src/components/message-table-cells';
import { fireEvent } from '@testing-library/react';
import type { MessageRow } from '../../src/components/message-table-types';

vi.mock('react-router', () => ({
  Link: (props: any) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}));

vi.mock('../../src/services/formatters.js', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
  formatNumber: (v: number) => String(v),
  formatStatus: (s: string) =>
    ({ ok: 'Success', error: 'Failed', rate_limited: 'Failed', fallback_error: 'Handled' })[s] ?? s,
  formatTime: (t: string) => t,
  formatDateTime: (t: string) => t,
  formatDuration: (ms: number) => `${ms}ms`,
  formatErrorMessage: (s: string) => s,
  customProviderColor: () => '#6366f1',
}));

vi.mock('../../src/services/routing-utils.js', () => ({
  // Mirror the real helpers' custom-provider behavior so ModelCell's custom
  // branch is exercised; non-custom inputs behave exactly as before.
  inferProviderFromModel: (m: string) => (m.startsWith('custom:') ? 'custom' : null),
  inferProviderName: (m: string) => m,
  resolveProviderId: (p: string) => (p.startsWith('custom:') ? p : undefined),
  stripCustomPrefix: (m: string) => m.replace(/^custom:[^/]+\//, ''),
}));

vi.mock('../../src/services/model-display.js', () => ({
  getModelDisplayName: (slug: string) => slug,
}));

vi.mock('../../src/components/ProviderIcon.jsx', () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock('../../src/components/AuthBadge.js', () => ({
  authBadgeFor: () => null,
  authLabel: () => 'API Key',
}));

vi.mock('../../src/components/InfoTooltip.jsx', () => ({
  default: (props: any) => <span title={props.text} />,
}));

function baseRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: '1',
    timestamp: '2025-01-01T00:00:00Z',
    agent_name: 'demo',
    model: 'gpt-4o',
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost: 0.01,
    status: 'success',
    ...overrides,
  };
}

describe('FallbackIcon', () => {
  it('renders with aria-hidden', () => {
    const { container } = render(<FallbackIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('HeartbeatIcon', () => {
  it('renders with aria-hidden', () => {
    const { container } = render(<HeartbeatIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('AttemptsCell', () => {
  function renderCell(row: MessageRow) {
    return render(
      <table>
        <tbody>
          <tr>{AttemptsCell(row)}</tr>
        </tbody>
      </table>,
    );
  }

  it('renders attempts and recovery attempts separated by a slash', () => {
    const { container } = renderCell(
      baseRow({ fallback_from_model: 'gpt-4o', attempt_count: 3, recovery_count: 2 }),
    );
    expect(container.querySelector('td')!.textContent).toBe('3 / 2');
  });

  it('renders zero recovery attempts when no fallback applies', () => {
    const { container } = renderCell(baseRow({ attempt_count: 1 }));
    expect(container.querySelector('td')!.textContent).toBe('1 / 0');
  });

  it('counts one recovery attempt for a fallback row without recovery_count', () => {
    const { container } = renderCell(baseRow({ fallback_from_model: 'gpt-4o', attempt_count: 2 }));
    expect(container.querySelector('td')!.textContent).toBe('2 / 1');
  });
});

describe('AgentCell', () => {
  it('renders agent_name when present', () => {
    const row = baseRow({ agent_name: 'my-agent' });
    const { container } = render(
      <table>
        <tbody>
          <tr>{AgentCell(row)}</tr>
        </tbody>
      </table>,
    );
    expect(container.textContent).toContain('my-agent');
  });

  it('renders em dash when agent_name is null', () => {
    const row = baseRow({ agent_name: null });
    const { container } = render(
      <table>
        <tbody>
          <tr>{AgentCell(row)}</tr>
        </tbody>
      </table>,
    );
    expect(container.textContent).toContain('—');
  });
});

describe('StatusCell shape', () => {
  function renderCell(row: MessageRow) {
    return render(
      <table>
        <tbody>
          <tr>{StatusCell(row, undefined)}</tr>
        </tbody>
      </table>,
    );
  }

  const shapeOf = (container: HTMLElement) => {
    const shapes = container.querySelectorAll('.status-shape');
    expect(shapes.length).toBe(1);
    return shapes[0] as HTMLElement;
  };

  it.each([
    [{ status: 'ok' }, 'success', 'Success'],
    [{ status: 'ok', fallback_from_model: 'gpt-4o' }, 'fallback', 'Succeeded after a fallback'],
    [{ status: 'error', error_origin: 'provider' }, 'failed', 'Failed: Provider'],
    [{ status: 'rate_limited', error_origin: 'provider' }, 'failed', 'Failed: Provider'],
    [{ status: 'fallback_error', error_origin: 'transport' }, 'failed', 'Failed: Transport'],
    [{ status: 'error', error_origin: 'request' }, 'failed', 'Failed: Bad request'],
    [{ status: 'pending' }, 'pending', 'Pending'],
    [{ status: 'cancelled' }, 'cancelled', 'Cancelled'],
  ] as Array<[Partial<MessageRow>, string, string]>)(
    'renders %o as the %s shape titled %s',
    (row, shape, label) => {
      const { container } = renderCell(baseRow(row));
      expect(statusShape(baseRow(row))).toBe(shape);
      const icon = shapeOf(container);
      expect(icon.getAttribute('title')).toBe(label);
      expect(icon.getAttribute('aria-label')).toBe(label);
      expect(icon.textContent).toBe('');
      expect(container.querySelector('a')).toBeNull();
    },
  );

  it("links a Thinker limit to its agent's limits page", () => {
    const row = baseRow({
      agent_name: 'billing-bot',
      status: 'error',
      error_origin: 'policy',
      error_class: 'limit_exceeded',
    });
    const { container } = renderCell(row);
    expect(statusShape(row)).toBe('limit');
    const link = container.querySelector('a');
    expect(link!.getAttribute('href')).toContain('/harnesses/billing-bot/limits');
    expect(shapeOf(container).getAttribute('title')).toMatch(/limit/i);
  });

  it('renders a Thinker limit with no agent without a link', () => {
    const { container } = renderCell(
      baseRow({ agent_name: null, status: 'error', error_origin: 'policy' }),
    );
    expect(container.querySelector('a')).toBeNull();
    shapeOf(container);
  });
});

describe('ModelCell', () => {
  it('renders a virtual model badge, ahead of any tier badge', () => {
    const row = baseRow({
      virtual_model_id: 'vm-1',
      virtual_model_name: 'deepseek/flash',
      routing_tier: 'default',
    });
    const { container } = render(
      <table>
        <tbody>
          <tr>{ModelCell(row)}</tr>
        </tbody>
      </table>,
    );
    const badge = container.querySelector('.tier-badge--virtual');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('deepseek/flash');
    expect(badge!.getAttribute('title')).toBe('Virtual model: deepseek/flash');
    expect(container.querySelector('.tier-badge--default')).toBeNull();
  });

  it('renders a custom row with just the model text and the provider name in the tooltip', () => {
    const row = baseRow({
      model: 'custom:u-1/openai/gpt-oss-120b',
      provider: 'custom:u-1',
      custom_provider_name: 'MyLLM',
    });
    const { container } = render(
      <table>
        <tbody>
          <tr>{ModelCell(row)}</tr>
        </tbody>
      </table>,
    );
    expect(container.textContent).toContain('openai/gpt-oss-120b');
    expect(container.textContent).not.toContain('custom:');
    expect(container.textContent).not.toContain('Custom');
    expect(container.querySelector('[title="MyLLM"]')).not.toBeNull();
  });

  it('falls back to a letter avatar from the model when the custom provider was deleted', () => {
    const row = baseRow({
      model: 'custom:gone/my-model',
      provider: 'custom:gone',
      custom_provider_name: null,
    });
    const { container } = render(
      <table>
        <tbody>
          <tr>{ModelCell(row)}</tr>
        </tbody>
      </table>,
    );
    expect(container.textContent).toContain('my-model');
    expect(container.textContent).not.toContain('custom:');
    const avatar = container.querySelector('.provider-card__logo-letter');
    expect(avatar).not.toBeNull();
    expect(avatar!.textContent).toBe('M');
  });
});
