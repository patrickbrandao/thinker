/**
 * Per-connection attempt analytics under /api/v1/provider-analytics:
 * attempt-status-timeseries, attempt-http-status-timeseries, attempt-breakdown
 * and attempts-by-agent-timeseries. Every call is one provider attempt
 * (agent_messages row), scoped to one connection, one tenant, outside the
 * Playground, and only once it has completed.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TEST_AGENT_ID, TEST_API_KEY, TEST_TENANT_ID } from './helpers';

const OTHER_USER = 'pa-attempts-other-user';
const LONELY_USER = 'pa-attempts-lonely-user';
const OTHER_TENANT = 'pa-attempts-other-tenant';
const PLAYGROUND_AGENT = 'pa-attempts-playground';

const C_WORK = randomUUID(); // openai / api_key / "Work"
const C_PERSONAL = randomUUID(); // openai / api_key / "Personal"
const C_OTHER = randomUUID(); // belongs to OTHER_TENANT

let app: INestApplication;
let ds: DataSource;

const api = () => request(app.getHttpServer());
const asOwner = (req: request.Test) => req.set('x-api-key', TEST_API_KEY);
const asOther = (req: request.Test) =>
  req.set('x-api-key', TEST_API_KEY).set('x-test-user-id', OTHER_USER);
const asLonely = (req: request.Test) =>
  req.set('x-api-key', TEST_API_KEY).set('x-test-user-id', LONELY_USER);

const base = '/api/v1/provider-analytics';
const work = { connection_id: C_WORK, provider: 'openai', auth_type: 'api_key', label: 'Work' };

interface Attempt {
  tenant?: string;
  agentId?: string | null;
  agentName?: string | null;
  status: string;
  httpStatus?: number | null;
  fallbackFrom?: string | null;
  connection?: string | null;
  provider?: string;
  authType?: string | null;
  label?: string | null;
  /** SQL interval subtracted from now(). */
  age?: string;
}

async function insertAttempt(a: Attempt): Promise<void> {
  await ds.query(
    `INSERT INTO agent_messages
       (id, tenant_id, agent_id, agent_name, timestamp, status, error_http_status,
        fallback_from_model, tenant_provider_id, provider, auth_type, provider_key_label, model)
     VALUES ($1, $2, $3, $4, now() - ($5)::interval, $6, $7, $8, $9, $10, $11, $12, 'gpt-x')`,
    [
      randomUUID(),
      a.tenant ?? TEST_TENANT_ID,
      a.agentId === undefined ? TEST_AGENT_ID : a.agentId,
      a.agentName === undefined ? 'test-agent' : a.agentName,
      a.age ?? '5 minutes',
      a.status,
      a.httpStatus ?? null,
      a.fallbackFrom ?? null,
      a.connection === undefined ? C_WORK : a.connection,
      a.provider ?? 'openai',
      a.authType === undefined ? 'api_key' : a.authType,
      a.label === undefined ? 'Work' : a.label,
    ],
  );
}

/** Totals per key across every bucket, so an hour boundary during the run cannot matter. */
function totals(body: {
  keys: string[];
  buckets: Array<{ bucket: string; counts: number[] }>;
}): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(body.keys.map((k) => [k, 0]));
  for (const bucket of body.buckets) {
    expect(bucket.counts).toHaveLength(body.keys.length);
    body.keys.forEach((key, i) => (out[key] += bucket.counts[i]));
  }
  return out;
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  await ds.query(
    `INSERT INTO tenants (id, name, organization_name, is_active) VALUES ($1, $1, 'Other', true)`,
    [OTHER_TENANT],
  );
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [OTHER_TENANT, OTHER_USER],
  );
  await ds.query(
    `INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label) VALUES
       ($1, $4, 'openai', 'api_key', 'Work'),
       ($2, $4, 'openai', 'api_key', 'Personal'),
       ($3, $5, 'openai', 'api_key', 'Work')`,
    [C_WORK, C_PERSONAL, C_OTHER, TEST_TENANT_ID, OTHER_TENANT],
  );
  await ds.query(
    `INSERT INTO agents (id, name, display_name, description, is_active, is_playground, complexity_routing_enabled, tenant_id, created_at, updated_at)
     VALUES ($1, 'Playground', 'Playground', 'reserved', true, true, true, $2, now(), now())`,
    [PLAYGROUND_AGENT, TEST_TENANT_ID],
  );

  // --- The "Work" connection of the test tenant -------------------------
  await insertAttempt({ status: 'ok' }); // success
  await insertAttempt({ status: 'ok', fallbackFrom: 'gpt-prev' }); // fallback retry that worked
  await insertAttempt({ status: 'error', httpStatus: 429 });
  await insertAttempt({
    status: 'error',
    httpStatus: 500,
    agentId: null,
    agentName: 'second-agent',
  });
  await insertAttempt({ status: 'error', agentId: null, agentName: null }); // provider never answered
  await insertAttempt({
    status: 'fallback_error',
    httpStatus: 502,
    fallbackFrom: 'gpt-prev',
    agentId: null,
    agentName: 'second-agent',
  }); // fallback retry that failed
  // Legacy rows without a connection id, matched by their key label (case-insensitive).
  await insertAttempt({ status: 'ok', connection: null, label: 'work' });
  await insertAttempt({
    status: 'ok',
    connection: null,
    authType: null,
    label: null,
    agentId: null,
    agentName: 'legacy-default',
  }); // legacy row with no label: the "Default" key
  // Not completed yet, or not a provider call that counts.
  await insertAttempt({ status: 'pending' });
  await insertAttempt({ status: 'cancelled' });
  await insertAttempt({ status: 'ok', agentId: PLAYGROUND_AGENT, agentName: 'Playground' });
  await insertAttempt({ status: 'ok', agentId: null, agentName: 'Playground' }); // orphan Playground row
  // Outside the 24h / 7d windows.
  await insertAttempt({ status: 'ok', age: '10 days' });
  await insertAttempt({ status: 'error', httpStatus: 503, age: '10 days' });

  // --- Other connections / providers of the same tenant -----------------
  for (let i = 0; i < 3; i++) {
    await insertAttempt({ status: 'ok', connection: C_PERSONAL, label: 'Personal' });
  }
  await insertAttempt({
    status: 'error',
    httpStatus: 401,
    connection: C_PERSONAL,
    label: 'Personal',
  });
  await insertAttempt({ status: 'ok', provider: 'anthropic', label: 'Work' });
  await insertAttempt({ status: 'ok', authType: 'subscription', label: 'Work' });

  // --- Another tenant: one row even points at the test tenant's connection id
  await insertAttempt({
    tenant: OTHER_TENANT,
    agentId: null,
    agentName: 'other-agent',
    status: 'ok',
    connection: C_OTHER,
  });
  await insertAttempt({
    tenant: OTHER_TENANT,
    agentId: null,
    agentName: 'other-agent',
    status: 'error',
    httpStatus: 418,
    connection: C_OTHER,
  });
  await insertAttempt({
    tenant: OTHER_TENANT,
    agentId: null,
    agentName: 'other-agent',
    status: 'ok',
    connection: C_WORK,
  });
}, 60000);

afterAll(async () => {
  await app.close();
});

const ROUTES = [
  'attempt-status-timeseries',
  'attempt-http-status-timeseries',
  'attempt-breakdown',
  'attempts-by-agent-timeseries',
] as const;

describe('authentication', () => {
  it.each(ROUTES)('%s requires a credential', async (route) => {
    await api().get(`${base}/${route}`).query(work).expect(401);
  });
});

describe('GET attempt-status-timeseries', () => {
  it('counts every completed attempt of the connection as success or error', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(res.body).toMatchObject({ range: '24h', by: 'metric', keys: ['success', 'error'] });
    // success: two ok attempts and the legacy row labelled 'work'. The legacy row with a
    // NULL label reads as "Default", another key, and stays out.
    expect(totals(res.body)).toEqual({ success: 3, error: 4 });
  });

  it('uses hourly buckets for hourly ranges and daily buckets otherwise', async () => {
    const hourly = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    for (const b of hourly.body.buckets) expect(b.bucket).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00:00$/);
    const daily = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    for (const b of daily.body.buckets) expect(b.bucket).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(totals(daily.body)).toEqual({ success: 3, error: 4 });
  });

  it('defaults to 7 days and widens with the range', async () => {
    const dflt = await asOwner(api().get(`${base}/attempt-status-timeseries`).query(work)).expect(
      200,
    );
    expect(dflt.body.range).toBe('7d');
    expect(totals(dflt.body)).toEqual({ success: 3, error: 4 });
    const month = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '30d' }),
    ).expect(200);
    // The 10-day-old ok and error attempts come into view.
    expect(totals(month.body)).toEqual({ success: 4, error: 5 });
  });

  it('keeps sibling connections of the same provider apart', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ connection_id: C_PERSONAL, label: 'Personal', range: '24h' }),
    ).expect(200);
    expect(totals(res.body)).toEqual({ success: 3, error: 1 });
  });

  it('narrows by provider and auth type', async () => {
    const anthropic = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, provider: 'anthropic' }),
    ).expect(200);
    expect(totals(anthropic.body)).toEqual({ success: 1, error: 0 });
    const none = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, provider: 'mistral' }),
    ).expect(200);
    expect(none.body.buckets).toEqual([]);
    const subscription = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, auth_type: 'subscription' }),
    ).expect(200);
    expect(totals(subscription.body)).toEqual({ success: 1, error: 0 });
  });

  it('folds a legacy NULL auth type into api_key', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ connection_id: C_WORK, auth_type: 'api_key', provider: 'openai' }),
    ).expect(200);
    // Without a label, legacy rows are matched as "Default": the one with a NULL label and a
    // NULL auth type (read as api_key) joins, and the one labelled 'work' leaves.
    expect(totals(res.body)).toEqual({ success: 3, error: 4 });
    const agents = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ connection_id: C_WORK, auth_type: 'api_key', provider: 'openai', range: '24h' }),
    ).expect(200);
    expect(agents.body.agents).toContain('legacy-default');
  });

  it('never counts another tenant, even through the same connection id', async () => {
    const mine = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(totals(mine.body).success).toBe(3); // the other tenant's ok row on C_WORK is not here
    const theirs = await asOther(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ connection_id: C_OTHER, label: 'Work', range: '24h' }),
    ).expect(200);
    expect(totals(theirs.body)).toEqual({ success: 1, error: 1 });
    // The other tenant querying the test tenant's connection sees only its own stray row.
    const probe = await asOther(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(totals(probe.body)).toEqual({ success: 1, error: 0 });
  });

  it('is empty for a user with no organization', async () => {
    const res = await asLonely(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(res.body).toEqual({ range: '24h', by: 'metric', keys: [], buckets: [] });
  });
});

describe('GET attempt-http-status-timeseries', () => {
  it('reads successes as 200 and failures by their own code, ordered success, codes, No response', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-http-status-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(res.body.by).toBe('metric');
    expect(res.body.keys).toEqual(['200', '429', '500', '502', 'No response']);
    expect(totals(res.body)).toEqual({ '200': 3, '429': 1, '500': 1, '502': 1, 'No response': 1 });
  });

  it('keeps counts aligned with the keys in every bucket', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-http-status-timeseries`)
        .query({ ...work, range: '30d' }),
    ).expect(200);
    expect(res.body.keys).toEqual(['200', '429', '500', '502', '503', 'No response']);
    for (const bucket of res.body.buckets) expect(bucket.counts).toHaveLength(res.body.keys.length);
    expect(totals(res.body)['503']).toBe(1);
  });

  it('agrees with the status view: success and failures add up to the same attempts', async () => {
    const status = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    const http = await asOwner(
      api()
        .get(`${base}/attempt-http-status-timeseries`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(totals(http.body))).toBe(sum(totals(status.body)));
  });

  it('is isolated per tenant and empty without an organization', async () => {
    const theirs = await asOther(
      api()
        .get(`${base}/attempt-http-status-timeseries`)
        .query({ connection_id: C_OTHER, label: 'Work', range: '24h' }),
    ).expect(200);
    expect(theirs.body.keys).toEqual(['200', '418']);
    const lonely = await asLonely(
      api()
        .get(`${base}/attempt-http-status-timeseries`)
        .query({ ...work }),
    ).expect(200);
    expect(lonely.body).toEqual({ range: '7d', by: 'metric', keys: [], buckets: [] });
  });
});

describe('GET attempt-breakdown', () => {
  it('totals attempts and the fallback retries with their own outcome', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-breakdown`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(res.body).toEqual({
      attempts: 7,
      succeeded: 3,
      failed: 4,
      fallback_retries: 2,
      fallback_retries_succeeded: 1,
    });
  });

  it('excludes pending, cancelled and Playground attempts', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-breakdown`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    // 2 pending/cancelled + 2 Playground rows would raise this above 7.
    expect(res.body.attempts).toBe(7);
  });

  it('honors the range', async () => {
    const week = await asOwner(
      api()
        .get(`${base}/attempt-breakdown`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    expect(week.body.attempts).toBe(7);
    const month = await asOwner(
      api()
        .get(`${base}/attempt-breakdown`)
        .query({ ...work, range: '30d' }),
    ).expect(200);
    expect(month.body).toMatchObject({ attempts: 9, succeeded: 4, failed: 5 });
  });

  it('keeps failed = attempts - succeeded', async () => {
    for (const query of [{ ...work }, { connection_id: C_PERSONAL, label: 'Personal' }]) {
      const res = await asOwner(api().get(`${base}/attempt-breakdown`).query(query)).expect(200);
      expect(res.body.failed).toBe(res.body.attempts - res.body.succeeded);
    }
  });

  it('scopes to the connection requested', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempt-breakdown`)
        .query({ connection_id: C_PERSONAL, label: 'Personal' }),
    ).expect(200);
    expect(res.body).toEqual({
      attempts: 4,
      succeeded: 3,
      failed: 1,
      fallback_retries: 0,
      fallback_retries_succeeded: 0,
    });
  });

  it("does not let one tenant read another's connection", async () => {
    const crossed = await asOther(
      api()
        .get(`${base}/attempt-breakdown`)
        .query({ connection_id: C_PERSONAL, label: 'Personal' }),
    ).expect(200);
    expect(crossed.body.attempts).toBe(0);
    const own = await asOther(
      api().get(`${base}/attempt-breakdown`).query({ connection_id: C_OTHER, label: 'Work' }),
    ).expect(200);
    expect(own.body).toMatchObject({ attempts: 2, succeeded: 1, failed: 1 });
  });

  it('answers zeros without an organization', async () => {
    const res = await asLonely(api().get(`${base}/attempt-breakdown`).query(work)).expect(200);
    expect(res.body).toEqual({
      attempts: 0,
      succeeded: 0,
      failed: 0,
      fallback_retries: 0,
      fallback_retries_succeeded: 0,
    });
  });
});

describe('GET attempts-by-agent-timeseries', () => {
  const countsByAgent = (body: {
    agents: string[];
    timeseries: Array<Record<string, number | string>>;
  }) => {
    const out: Record<string, number> = {};
    for (const point of body.timeseries) {
      for (const [key, value] of Object.entries(point)) {
        if (key === 'hour' || key === 'date') continue;
        out[key] = (out[key] ?? 0) + Number(value);
      }
    }
    return out;
  };

  it('splits the connection attempts per harness, sorted, with Unknown for no name', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(res.body.agents).toEqual(['Unknown', 'second-agent', 'test-agent']);
    expect(res.body.agents).not.toContain('legacy-default');
    expect(countsByAgent(res.body)).toEqual({ Unknown: 1, 'second-agent': 2, 'test-agent': 4 });
  });

  it('adds up to the same total as the status view', async () => {
    const byAgent = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    const status = await asOwner(
      api()
        .get(`${base}/attempt-status-timeseries`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(countsByAgent(byAgent.body))).toBe(sum(totals(status.body)));
  });

  it('keys the points by hour for hourly ranges and by date otherwise', async () => {
    const hourly = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    for (const point of hourly.body.timeseries) {
      expect(point.hour).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00:00$/);
      expect(point).not.toHaveProperty('date');
    }
    const daily = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ ...work, range: '7d' }),
    ).expect(200);
    for (const point of daily.body.timeseries) {
      expect(point.date).toMatch(/^\d{4}-\d\d-\d\d$/);
      expect(point).not.toHaveProperty('hour');
    }
  });

  it('leaves the Playground out', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ ...work, range: '24h' }),
    ).expect(200);
    expect(res.body.agents).not.toContain('Playground');
  });

  it('is isolated per tenant and empty without an organization', async () => {
    const theirs = await asOther(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ connection_id: C_OTHER, label: 'Work', range: '24h' }),
    ).expect(200);
    expect(theirs.body.agents).toEqual(['other-agent']);
    expect(countsByAgent(theirs.body)).toEqual({ 'other-agent': 2 });
    const lonely = await asLonely(
      api().get(`${base}/attempts-by-agent-timeseries`).query(work),
    ).expect(200);
    expect(lonely.body).toEqual({ agents: [], timeseries: [] });
  });

  it('is empty for a connection with no attempts', async () => {
    const res = await asOwner(
      api()
        .get(`${base}/attempts-by-agent-timeseries`)
        .query({ connection_id: randomUUID(), label: 'Nothing', range: '24h' }),
    ).expect(200);
    expect(res.body).toEqual({ agents: [], timeseries: [] });
  });
});
