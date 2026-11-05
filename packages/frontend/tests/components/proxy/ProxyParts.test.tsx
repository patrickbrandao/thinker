import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  EgressHops,
  EgressName,
  endpointOf,
  formatBytes,
  ProxyStatusBadge,
  resultLabel,
  sourceTypeLabel,
} from '../../../src/components/proxy/ProxyParts';
import { resetLocaleForTests, t } from '../../../src/i18n';

const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('ProxyParts helpers', () => {
  it('endpointOf brackets IPv6 hosts', () => {
    expect(endpointOf({ scheme: 'http', host: 'proxy.example.com', port: 3128 })).toBe(
      'http://proxy.example.com:3128',
    );
    expect(endpointOf({ scheme: 'https', host: '::1', port: 8443 })).toBe('https://[::1]:8443');
  });

  it('formatBytes scales units and rounds', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024)).toBe('20 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
    // Never past TB.
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB');
  });

  it('resultLabel and sourceTypeLabel translate known codes and keep unknown ones', () => {
    expect(resultLabel('auth_407')).toBe('Auth required (407)');
    expect(resultLabel('something_new')).toBe('something_new');
    expect(sourceTypeLabel('email_config')).toBe('Notification e-mail');
    expect(sourceTypeLabel('mystery')).toBe('mystery');
  });
});

describe('ProxyStatusBadge', () => {
  it.each([
    ['ok', 'Healthy'],
    ['degraded', 'Degraded'],
    ['failing', 'Failing'],
    ['idle', 'Idle'],
    ['disabled', 'Disabled'],
  ] as const)('renders %s as %s', (status, label) => {
    wrap(<ProxyStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows an unknown status verbatim', () => {
    wrap(<ProxyStatusBadge status={'weird' as never} />);
    expect(screen.getByText('weird')).toBeTruthy();
  });
});

describe('EgressName', () => {
  it('names Direct and the global proxy without a link', () => {
    wrap(
      <>
        <EgressName egress={{ kind: 'direct', proxy_id: null, name: null }} />
        <EgressName egress={{ kind: 'global', proxy_id: null, name: null }} />
      </>,
    );
    expect(screen.getByText('Direct')).toBeTruthy();
    expect(screen.getByText('Global proxy')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links a proxy to its page, encoding the id', () => {
    wrap(<EgressName egress={{ kind: 'proxy', proxy_id: 'a/b', name: 'Alpha' }} />);
    expect(screen.getByRole('link', { name: 'Alpha' }).getAttribute('href')).toBe(
      '/proxy-servers/a%2Fb',
    );
  });

  it('shows a deleted proxy as plain text', () => {
    wrap(<EgressName egress={{ kind: 'proxy', proxy_id: null, name: null }} />);
    expect(screen.getByText('Deleted proxy')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('EgressHops', () => {
  const hops = [
    { kind: 'proxy' as const, proxy_id: 'p1', name: 'Alpha', position: 0, result: 'auth_407', ms: 12, tunnel_ms: null, status: 407, error: 'proxy said no' },
    { kind: 'proxy' as const, proxy_id: 'p2', name: 'Beta', position: 1, result: 'skipped_disabled', ms: null, tunnel_ms: null, status: null },
    { kind: 'direct' as const, proxy_id: null, name: null, position: 2, result: 'ok', ms: 30, tunnel_ms: null, status: 200 },
  ];

  it('lists every hop in order with arrows and a result per hop', () => {
    const { container } = wrap(<EgressHops hops={hops} />);
    const text = container.textContent ?? '';
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'));
    expect(text.indexOf('Beta')).toBeLessThan(text.indexOf('Direct'));
    expect(screen.getByText('Auth required (407)')).toBeTruthy();
    expect(screen.getByText('Skipped (disabled)')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
  });

  it('puts the error (or the duration) in the hop tooltip', () => {
    const { container } = wrap(<EgressHops hops={hops} />);
    const titles = Array.from(container.querySelectorAll('span[title]')).map((e) =>
      e.getAttribute('title'),
    );
    expect(titles).toEqual(['proxy said no', '30 ms']);
  });

  it('renders in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    wrap(<EgressHops hops={hops} />);
    expect(screen.getByText(t('proxies.results.auth_407'))).toBeTruthy();
    expect(t('proxies.results.skipped_disabled')).not.toBe('Skipped (disabled)');
    expect(screen.getByText(t('proxies.egress.direct'))).toBeTruthy();
  });
});
