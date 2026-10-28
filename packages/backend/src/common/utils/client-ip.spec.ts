import {
  DEFAULT_TRUSTED_PROXIES,
  TrustedProxiesError,
  loadTrustedProxies,
  normalizeIp,
  resolveClientIp,
} from './client-ip';

type Row = [
  peer: string,
  xff: string | null,
  realIp: string | null,
  client: string,
  source: string,
];

const run = (trusted: ReturnType<typeof loadTrustedProxies>, [peer, xff, realIp]: Row) =>
  resolveClientIp(
    {
      peer,
      forwardedFor: xff === null ? undefined : [xff],
      realIp: realIp === null ? undefined : [realIp],
    },
    trusted,
  );

describe('resolveClientIp with the default private ranges', () => {
  const trusted = loadTrustedProxies(undefined);
  const rows: Row[] = [
    ['45.80.10.20', '6.6.6.6', '6.6.6.6', '45.80.10.20', 'tcp'],
    ['172.18.0.5', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['172.18.0.5', '6.6.6.6, 45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['10.0.0.3', null, '45.80.10.20', '45.80.10.20', 'x-real-ip'],
    ['192.168.1.10', 'unknown', '45.80.10.20', '45.80.10.20', 'x-real-ip'],
    ['172.18.0.5', null, null, '172.18.0.5', 'tcp'],
    ['172.18.0.5', '2804:14c::5', null, '2804:14c::5', 'x-forwarded-for'],
    ['::ffff:172.18.0.5', '45.80.10.20:4711', null, '45.80.10.20', 'x-forwarded-for'],
    ['100.64.0.7', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['127.0.0.1', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['172.18.0.5', '45.80.10.20, 10.0.0.9', null, '45.80.10.20', 'x-forwarded-for'],
    ['172.18.0.5', '10.0.0.9', null, '10.0.0.9', 'x-forwarded-for'],
    ['fd00::2', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['2804:14c::9', '6.6.6.6', null, '2804:14c::9', 'tcp'],
  ];

  it.each(rows)('peer %s, XFF %s, X-Real-IP %s → %s (%s)', (...row) => {
    const result = run(trusted, row);
    expect(result).toEqual({
      clientIp: row[3],
      source: row[4],
      peerIp: normalizeIp(row[0]),
    });
  });

  it('warns when a trusted proxy sends no forwarding header', () => {
    const warn = jest.fn();
    resolveClientIp({ peer: '172.18.0.5' }, trusted, warn);
    expect(warn).toHaveBeenCalledWith('172.18.0.5');
  });

  it('keeps only the rightmost entries of an oversized X-Forwarded-For', () => {
    const forged = Array.from({ length: 500 }, () => '6.6.6.6').join(', ');
    const result = resolveClientIp(
      { peer: '172.18.0.5', forwardedFor: [`${forged}, 45.80.10.20`] },
      trusted,
    );
    expect(result.clientIp).toBe('45.80.10.20');
  });

  it('joins every X-Forwarded-For occurrence in order', () => {
    const result = resolveClientIp(
      { peer: '172.18.0.5', forwardedFor: ['6.6.6.6', '45.80.10.20, 10.0.0.9'] },
      trusted,
    );
    expect(result.clientIp).toBe('45.80.10.20');
  });
});

describe('resolveClientIp with TRUSTED_PROXIES=172.30.0.2/32', () => {
  const trusted = loadTrustedProxies('172.30.0.2/32');
  const rows: Row[] = [
    ['172.30.0.2', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['172.18.0.5', '45.80.10.20', '45.80.10.20', '172.18.0.5', 'tcp'],
    ['172.30.0.2', '45.80.10.20, 10.0.0.9', null, '10.0.0.9', 'x-forwarded-for'],
    ['100.64.0.7', '6.6.6.6', null, '100.64.0.7', 'tcp'],
    ['172.30.0.7', '45.80.10.20', '45.80.10.20', '172.30.0.7', 'tcp'],
  ];

  it.each(rows)('peer %s, XFF %s, X-Real-IP %s → %s (%s)', (...row) => {
    expect(run(trusted, row)).toEqual({ clientIp: row[3], source: row[4], peerIp: row[0] });
  });
});

describe('loadTrustedProxies', () => {
  it.each([undefined, '', '   '])('uses the default list when the value is %p', (raw) => {
    const set = loadTrustedProxies(raw);
    expect(set.mode).toBe('default');
    expect(set.prefixes).toEqual([...DEFAULT_TRUSTED_PROXIES]);
  });

  it('turns a lone address into a host prefix', () => {
    expect(loadTrustedProxies('172.30.0.2')).toMatchObject({
      mode: 'env',
      prefixes: ['172.30.0.2/32'],
    });
  });

  it('accepts IPv4 and IPv6 entries with spaces', () => {
    expect(loadTrustedProxies('172.30.0.2/32, fd00:1::10').prefixes).toEqual([
      '172.30.0.2/32',
      'fd00:1::10/128',
    ]);
  });

  it.each([
    ['172.30.0.2/32, abc', 'abc'],
    ['10.0.0.0/33', '10.0.0.0/33'],
  ])('fails on %p naming %p', (raw, entry) => {
    expect(() => loadTrustedProxies(raw)).toThrow(TrustedProxiesError);
    expect(() => loadTrustedProxies(raw)).toThrow(`"${entry}"`);
  });
});
