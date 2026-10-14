import { RenameThinkerRoutingReasons1803600000000 } from './1803600000000-RenameThinkerRoutingReasons';

describe('RenameThinkerRoutingReasons1803600000000', () => {
  const run = async (dir: 'up' | 'down') => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new RenameThinkerRoutingReasons1803600000000()[dir]({ query } as never);
    return query.mock.calls.map((c) => c[0] as string).join('\n');
  };
  const legacy = (r: string) => [['manifest', r].join('_')].join('');

  it('renames the legacy routing reasons to the thinker prefix', async () => {
    const sql = await run('up');
    expect(sql).toContain(`WHEN '${legacy('rate_limited')}' THEN 'thinker_rate_limited'`);
    expect(sql).toContain(`WHEN '${legacy('internal_error')}' THEN 'thinker_internal_error'`);
    expect(sql).toContain('WHERE "routing_reason" IN (');
  });

  it('restores the legacy prefix on down', async () => {
    const sql = await run('down');
    expect(sql).toContain(`WHEN 'thinker_invalid_request' THEN '${legacy('invalid_request')}'`);
  });
});
