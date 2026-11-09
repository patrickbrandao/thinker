import { createHmac } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TriggersModule } from '../src/triggers/triggers.module';
import { createTestApp, TEST_API_KEY, TEST_TENANT_ID, TEST_USER_ID } from './helpers';
import { closeServer, LOOPBACK_HOST, serveOnLoopback } from './loopback';

/**
 * Triggers over HTTP: CRUD, role gates, delivery log, retry, tenant isolation
 * and a real harness.created event delivered to a loopback webhook. Nothing
 * here leaves the machine: the webhook target is a loopback server.
 */
const ADMIN = 'trg-admin-user';
const MEMBER = 'trg-member-user';
const VIEWER = 'trg-viewer-user';
const OUTSIDER = 'trg-outsider-user';
const OTHER_ORG = 'trg-other-tenant';

let app: INestApplication;
let ds: DataSource;
let target: Server;
let targetUrl: string;
let targetStatus = 200;
const hits: Array<{ method: string; headers: IncomingMessage['headers']; body: string }> = [];
const savedSsrf = process.env['SKIP_SSRF_VALIDATION'];

const server = () => app.getHttpServer();
const as = (userId: string, req: request.Test) =>
  req.set('x-api-key', TEST_API_KEY).set('x-test-user-id', userId);
const asOwner = (req: request.Test) => as(TEST_USER_ID, req);

async function waitFor<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  ms = 8000,
) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const webhook = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'webhook',
  config: { url: `${targetUrl}/hook` },
  max_retries: 0,
  ...extra,
});

async function createTrigger(userId: string, body: Record<string, unknown>) {
  const res = await as(userId, request(server()).post('/api/v1/triggers')).send(body).expect(201);
  return res.body as { id: string; name: string };
}

beforeAll(async () => {
  // NODE_ENV=test skips URL validation unless it is forced back on; the
  // private-destination policy is part of what is under test here.
  process.env['SKIP_SSRF_VALIDATION'] = 'false';
  app = await createTestApp({ extraImports: [TriggersModule] });
  ds = app.get(DataSource);

  target = await serveOnLoopback((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      hits.push({
        method: req.method ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.statusCode = targetStatus;
      res.setHeader('content-type', 'text/plain');
      // A target that reflects a header lets a test check secret redaction.
      const echo = req.headers['x-echo'];
      res.end((targetStatus === 200 ? 'ok' : 'target says no') + (echo ? ` ${echo}` : ''));
    });
  });
  targetUrl = `http://${LOOPBACK_HOST}:${(target.address() as AddressInfo).port}`;

  await ds.query(
    `CREATE TABLE IF NOT EXISTS "user" (
       id VARCHAR PRIMARY KEY, email VARCHAR, name VARCHAR,
       "emailVerified" BOOLEAN DEFAULT true, "createdAt" TIMESTAMP DEFAULT NOW()
     )`,
  );
  for (const id of [TEST_USER_ID, ADMIN, MEMBER, VIEWER, OUTSIDER]) {
    await ds.query(`INSERT INTO "user" (id, email, name) VALUES ($1, $2, $1)`, [
      id,
      `${id}@test.local`,
    ]);
  }
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES
       ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member'), ($1, $5, 'viewer')`,
    [TEST_TENANT_ID, TEST_USER_ID, ADMIN, MEMBER, VIEWER],
  );
  await ds.query(
    `INSERT INTO tenants (id, name, organization_name, is_active) VALUES ($1, $1, 'Other', true)`,
    [OTHER_ORG],
  );
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [OTHER_ORG, OUTSIDER],
  );
});

afterAll(async () => {
  await app.close();
  await closeServer(target);
  if (savedSsrf === undefined) delete process.env['SKIP_SSRF_VALIDATION'];
  else process.env['SKIP_SSRF_VALIDATION'] = savedSsrf;
});

beforeEach(() => {
  hits.length = 0;
  targetStatus = 200;
});

describe('authentication', () => {
  it.each([
    ['get', '/api/v1/triggers'],
    ['post', '/api/v1/triggers'],
    ['patch', '/api/v1/triggers/x'],
    ['delete', '/api/v1/triggers/x'],
    ['post', '/api/v1/triggers/x/test'],
    ['get', '/api/v1/triggers/events'],
    ['get', '/api/v1/triggers/events/x'],
    ['post', '/api/v1/triggers/events/x/retry'],
    ['get', '/api/v1/agents/test-agent/triggers'],
    ['put', '/api/v1/agents/test-agent/triggers'],
  ] as const)('%s %s answers 401 without credentials', async (method, path) => {
    await request(server())[method](path).expect(401);
  });
});

describe('trigger CRUD', () => {
  let id: string;

  it('rejects an invalid trigger with the validation messages', async () => {
    const res = await asOwner(request(server()).post('/api/v1/triggers'))
      .send({ name: '', type: 'webhook', config: { url: 'ftp://nope' }, max_retries: 99 })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        'name is required',
        'config.url must be an http(s) URL',
        'max_retries must be between 0 and 10',
      ]),
    );
  });

  it('rejects an unknown trigger type and an empty body', async () => {
    await asOwner(request(server()).post('/api/v1/triggers'))
      .send({ name: 'x', type: 'pigeon' })
      .expect(400);
    await asOwner(request(server()).post('/api/v1/triggers')).send({}).expect(400);
  });

  it('creates a webhook trigger and never echoes its secrets', async () => {
    const res = await asOwner(request(server()).post('/api/v1/triggers'))
      .send(
        webhook('Primary hook', {
          secrets: { hmacSecret: 'super-secret-signing-key' },
          config: {
            url: `${targetUrl}/hook`,
            headers: [{ name: 'Authorization', value: 'Bearer abcdefghijklmnop' }],
          },
          workspace_events: ['harness.created'],
        }),
      )
      .expect(201);
    id = res.body.id;
    expect(res.body).toMatchObject({
      name: 'Primary hook',
      type: 'webhook',
      enabled: true,
      max_retries: 0,
      retry_delay_seconds: 30,
      timeout_seconds: 10,
      workspace_events: ['harness.created'],
      harness_count: 0,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('super-secret-signing-key');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(res.body.secrets.hmacSecret).toBe('super-…');
    expect(res.body.config.headers).toEqual([{ name: 'Authorization', hint: 'Bear…' }]);

    // Stored encrypted at rest.
    const [row] = await ds.query(`SELECT secrets_encrypted FROM triggers WHERE id = $1`, [id]);
    expect(row.secrets_encrypted).toEqual(expect.any(String));
    expect(row.secrets_encrypted).not.toContain('super-secret-signing-key');
  });

  it('refuses a second trigger with the same name, ignoring case', async () => {
    const res = await asOwner(request(server()).post('/api/v1/triggers'))
      .send(webhook('PRIMARY HOOK'))
      .expect(400);
    expect(res.body.message[0]).toContain('already exists');
  });

  it('lists the trigger for every role, including viewers', async () => {
    for (const user of [TEST_USER_ID, ADMIN, MEMBER, VIEWER]) {
      const res = await as(user, request(server()).get('/api/v1/triggers')).expect(200);
      expect(res.body.triggers.map((t: { id: string }) => t.id)).toContain(id);
    }
  });

  it('updates a trigger partially and keeps the stored secrets', async () => {
    const res = await asOwner(request(server()).patch(`/api/v1/triggers/${id}`))
      .send({ name: 'Renamed hook', enabled: false, retry_delay_seconds: 5 })
      .expect(200);
    expect(res.body).toMatchObject({
      id,
      name: 'Renamed hook',
      enabled: false,
      retry_delay_seconds: 5,
    });
    expect(res.body.secrets.hmacSecret).toBe('super-…');
    expect(res.body.config.headers).toEqual([{ name: 'Authorization', hint: 'Bear…' }]);
  });

  it('clears a secret with null', async () => {
    const res = await asOwner(request(server()).patch(`/api/v1/triggers/${id}`))
      .send({ secrets: { hmacSecret: null } })
      .expect(200);
    expect(res.body.secrets.hmacSecret).toBeNull();
  });

  it('refuses to change the type and invalid values', async () => {
    await asOwner(request(server()).patch(`/api/v1/triggers/${id}`))
      .send({ type: 'syslog' })
      .expect(400);
    await asOwner(request(server()).patch(`/api/v1/triggers/${id}`))
      .send({ timeout_seconds: 0 })
      .expect(400);
  });

  it('answers 404 for an unknown trigger', async () => {
    await asOwner(request(server()).patch('/api/v1/triggers/nope')).send({ name: 'x' }).expect(404);
    await asOwner(request(server()).delete('/api/v1/triggers/nope')).expect(404);
    await asOwner(request(server()).post('/api/v1/triggers/nope/test')).send({}).expect(404);
  });

  it('deletes the trigger', async () => {
    const created = await createTrigger(TEST_USER_ID, webhook('Short lived'));
    const res = await asOwner(request(server()).delete(`/api/v1/triggers/${created.id}`)).expect(
      200,
    );
    expect(res.body).toEqual({ deleted: true });
    const list = await asOwner(request(server()).get('/api/v1/triggers')).expect(200);
    expect(list.body.triggers.map((t: { id: string }) => t.id)).not.toContain(created.id);
    await asOwner(request(server()).delete(`/api/v1/triggers/${created.id}`)).expect(404);
  });
});

describe('roles and private destinations', () => {
  it('lets members and viewers read triggers but not manage them', async () => {
    const trigger = await createTrigger(TEST_USER_ID, webhook('Role probe'));
    for (const user of [MEMBER, VIEWER]) {
      const created = await as(user, request(server()).post('/api/v1/triggers'))
        .send(webhook('By ' + user))
        .expect(403);
      expect(created.body.code).toBe('insufficient_role');
      await as(user, request(server()).patch(`/api/v1/triggers/${trigger.id}`))
        .send({ name: 'hacked' })
        .expect(403);
      await as(user, request(server()).delete(`/api/v1/triggers/${trigger.id}`)).expect(403);
      await as(user, request(server()).post(`/api/v1/triggers/${trigger.id}/test`))
        .send({})
        .expect(403);
    }
  });

  it('keeps delivery logs from members and viewers', async () => {
    for (const user of [MEMBER, VIEWER]) {
      await as(user, request(server()).get('/api/v1/triggers/events')).expect(403);
      await as(user, request(server()).get('/api/v1/triggers/events/x')).expect(403);
      await as(user, request(server()).post('/api/v1/triggers/events/x/retry')).expect(403);
    }
  });

  it('lets an admin reach the delivery logs', async () => {
    await as(ADMIN, request(server()).get('/api/v1/triggers/events')).expect(200);
  });

  it('keeps private webhook targets to the owner by default', async () => {
    const refused = await as(ADMIN, request(server()).post('/api/v1/triggers'))
      .send(webhook('Admin private'))
      .expect(400);
    expect(refused.body.message[0]).toContain('config.url');

    const owner = await createTrigger(TEST_USER_ID, webhook('Owner private'));
    // The destination is re-checked on every update, so an admin cannot edit
    // (not even rename) a trigger the owner pointed at a private address.
    await as(ADMIN, request(server()).patch(`/api/v1/triggers/${owner.id}`))
      .send({ name: 'Owner private (edited)' })
      .expect(400);
    await asOwner(request(server()).patch(`/api/v1/triggers/${owner.id}`))
      .send({ name: 'Owner private (edited)' })
      .expect(200);
  });

  it('never allows cloud metadata endpoints, even for the owner', async () => {
    const res = await asOwner(request(server()).post('/api/v1/triggers')).send({
      name: 'Metadata',
      type: 'webhook',
      config: { url: 'http://169.254.169.254/latest/meta-data' },
    });
    // Owners may use private destinations, so creation is accepted; delivery
    // refuses the metadata address (ssrfSafeFetch).
    expect(res.status).toBe(201);
    const test = await asOwner(request(server()).post(`/api/v1/triggers/${res.body.id}/test`))
      .send({})
      .expect(201);
    expect(test.body.success).toBe(false);
    expect(test.body.error).toMatch(/metadata/i);
  });
});

describe('test delivery, delivery log and retry', () => {
  let triggerId: string;
  let eventId: string;

  beforeAll(async () => {
    const created = await createTrigger(
      TEST_USER_ID,
      webhook('Delivery hook', {
        secrets: { hmacSecret: 'signing-secret-123' },
        config: {
          url: `${targetUrl}/hook`,
          headers: [{ name: 'X-Token', value: 'header-token-value' }],
        },
      }),
    );
    triggerId = created.id;
  });

  it('delivers a test event to the webhook, signed and with the rendered payload', async () => {
    const res = await asOwner(request(server()).post(`/api/v1/triggers/${triggerId}/test`))
      .send({ vars: { 'event.title': 'Hello', 'event.message': 'From e2e' } })
      .expect(201);
    expect(res.body).toMatchObject({
      success: true,
      status_code: 200,
      error: null,
      response: 'ok',
    });

    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit.method).toBe('POST');
    expect(hit.headers['x-thinker-event']).toBe('test');
    expect(hit.headers['x-token']).toBe('header-token-value');
    expect(hit.headers['content-type']).toContain('application/json');
    expect(hit.headers['x-thinker-signature']).toBe(
      `sha256=${createHmac('sha256', 'signing-secret-123').update(hit.body).digest('hex')}`,
    );
    const body = JSON.parse(hit.body);
    expect(body).toMatchObject({
      'event.type': 'test',
      'event.title': 'Hello',
      'event.message': 'From e2e',
      'workspace.id': TEST_TENANT_ID,
      'trigger.name': 'Delivery hook',
      'delivery.attempt': '1',
      'actor.email': `${TEST_USER_ID}@test.local`,
    });
  });

  it('rejects an invalid simulated event before delivering anything', async () => {
    await asOwner(request(server()).post(`/api/v1/triggers/${triggerId}/test`))
      .send({ event_type: 'nope' })
      .expect(400);
    await asOwner(request(server()).post(`/api/v1/triggers/${triggerId}/test`))
      .send({ vars: { 'Bad Name': 'x' } })
      .expect(400);
    expect(hits).toHaveLength(0);
  });

  it('lists the delivered event and filters it', async () => {
    const all = await asOwner(request(server()).get('/api/v1/triggers/events')).expect(200);
    const mine = all.body.events.filter((e: { trigger_id: string }) => e.trigger_id === triggerId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      trigger_name: 'Delivery hook',
      trigger_type: 'webhook',
      event_type: 'test',
      status: 'delivered',
      attempts: 1,
      last_error: null,
    });
    expect(mine[0]).not.toHaveProperty('payload');

    const byTrigger = await asOwner(
      request(server()).get(`/api/v1/triggers/events?trigger_id=${triggerId}&status=delivered`),
    ).expect(200);
    expect(byTrigger.body.events).toHaveLength(1);
    const failedOnly = await asOwner(
      request(server()).get(`/api/v1/triggers/events?trigger_id=${triggerId}&status=failed`),
    ).expect(200);
    expect(failedOnly.body.events).toEqual([]);
    const byType = await asOwner(
      request(server()).get(
        `/api/v1/triggers/events?trigger_id=${triggerId}&event_type=limit.block`,
      ),
    ).expect(200);
    expect(byType.body.events).toEqual([]);
  });

  it('ignores an invalid status filter and clamps the limit', async () => {
    const res = await asOwner(
      request(server()).get(`/api/v1/triggers/events?status=%27%20OR%201=1&limit=-4`),
    ).expect(200);
    expect(res.body.events).toHaveLength(1);
  });

  it('records a failing delivery as failed when the trigger has no retries', async () => {
    targetStatus = 500;
    const res = await asOwner(request(server()).post(`/api/v1/triggers/${triggerId}/test`))
      .send({})
      .expect(201);
    expect(res.body).toMatchObject({
      success: false,
      status_code: 500,
      error: 'HTTP 500',
      response: 'target says no',
    });
    const list = await asOwner(
      request(server()).get(`/api/v1/triggers/events?trigger_id=${triggerId}&status=failed`),
    ).expect(200);
    expect(list.body.events).toHaveLength(1);
    eventId = list.body.events[0].id;
    expect(list.body.events[0]).toMatchObject({ attempts: 1, last_error: 'HTTP 500' });
    expect(list.body.events[0].next_attempt_at).toBeNull();
  });

  it('returns one event with its payload and per-attempt logs', async () => {
    const res = await asOwner(request(server()).get(`/api/v1/triggers/events/${eventId}`)).expect(
      200,
    );
    expect(res.body.event).toMatchObject({
      id: eventId,
      status: 'failed',
      trigger_name: 'Delivery hook',
    });
    expect(res.body.event.payload['event.type']).toBe('test');
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0]).toMatchObject({
      attempt: 1,
      success: false,
      status_code: 500,
      error: 'HTTP 500',
      response: 'target says no',
    });
  });

  it('redacts configured secrets from stored responses and errors', async () => {
    const leaky = await createTrigger(
      TEST_USER_ID,
      webhook('Leaky target', {
        config: {
          url: `${targetUrl}/hook`,
          headers: [{ name: 'X-Echo', value: 'target-says-this-value' }],
        },
      }),
    );
    targetStatus = 500;
    const res = await asOwner(request(server()).post(`/api/v1/triggers/${leaky.id}/test`))
      .send({})
      .expect(201);
    expect(res.body.response).toBe('target says no [redacted]');
    const stored = await ds.query(
      `SELECT response FROM trigger_event_logs WHERE response LIKE $1`,
      ['%[redacted]%'],
    );
    expect(stored.length).toBeGreaterThanOrEqual(1);
    const leaked = await ds.query(`SELECT 1 FROM trigger_event_logs WHERE response LIKE $1`, [
      '%target-says-this-value%',
    ]);
    expect(leaked).toEqual([]);
  });

  it('answers 404 for an unknown event', async () => {
    await asOwner(request(server()).get('/api/v1/triggers/events/does-not-exist')).expect(404);
  });

  it('retries a failed event and delivers it on the next pass', async () => {
    targetStatus = 200;
    hits.length = 0;
    const res = await asOwner(
      request(server()).post(`/api/v1/triggers/events/${eventId}/retry`),
    ).expect(201);
    expect(res.body).toEqual({ ok: true });

    await waitFor(async () => {
      const detail = await asOwner(request(server()).get(`/api/v1/triggers/events/${eventId}`));
      return detail.body.event?.status === 'delivered';
    });
    expect(hits).toHaveLength(1);
    expect(JSON.parse(hits[0].body)['delivery.attempt']).toBe('2');

    const detail = await asOwner(
      request(server()).get(`/api/v1/triggers/events/${eventId}`),
    ).expect(200);
    expect(detail.body.event).toMatchObject({ status: 'delivered', attempts: 2, last_error: null });
    expect(
      detail.body.logs.map((l: { attempt: number; success: boolean }) => [l.attempt, l.success]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('refuses to retry an event that is not failed, or does not exist', async () => {
    const delivered = await asOwner(
      request(server()).post(`/api/v1/triggers/events/${eventId}/retry`),
    ).expect(400);
    expect(delivered.body.message[0]).toContain('Only failed events');
    await asOwner(request(server()).post('/api/v1/triggers/events/nope/retry')).expect(400);
  });

  it('schedules a retry with a delay while the trigger still has retries left', async () => {
    const retrying = await createTrigger(
      TEST_USER_ID,
      webhook('Retrying hook', { max_retries: 2, retry_delay_seconds: 3600 }),
    );
    targetStatus = 503;
    await asOwner(request(server()).post(`/api/v1/triggers/${retrying.id}/test`))
      .send({})
      .expect(201);
    const list = await asOwner(
      request(server()).get(`/api/v1/triggers/events?trigger_id=${retrying.id}`),
    ).expect(200);
    expect(list.body.events[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'HTTP 503',
    });
    const dueAt = new Date(list.body.events[0].next_attempt_at).getTime();
    expect(dueAt).toBeGreaterThan(Date.now() + 3_000_000);
    // Not failed yet, so it cannot be retried by hand.
    await asOwner(
      request(server()).post(`/api/v1/triggers/events/${list.body.events[0].id}/retry`),
    ).expect(400);
  });

  it('fails a queued event for good once its trigger was deleted', async () => {
    const doomed = await createTrigger(
      TEST_USER_ID,
      webhook('Doomed hook', { max_retries: 5, retry_delay_seconds: 1 }),
    );
    targetStatus = 500;
    await asOwner(request(server()).post(`/api/v1/triggers/${doomed.id}/test`))
      .send({})
      .expect(201);
    const [event] = (
      await asOwner(
        request(server()).get(`/api/v1/triggers/events?trigger_id=${doomed.id}`),
      ).expect(200)
    ).body.events;
    expect(event.status).toBe('pending');

    await asOwner(request(server()).delete(`/api/v1/triggers/${doomed.id}`)).expect(200);
    const after = await asOwner(
      request(server()).get(`/api/v1/triggers/events/${event.id}`),
    ).expect(200);
    // The queue row survives with its snapshot of the trigger name.
    expect(after.body.event).toMatchObject({ trigger_name: 'Doomed hook', trigger_id: null });
    // A row whose trigger is gone cannot be retried either.
    await asOwner(request(server()).post(`/api/v1/triggers/events/${event.id}/retry`)).expect(400);
  });
});

describe('events from the product', () => {
  it('delivers harness.created to a trigger subscribed to workspace events, and stays quiet after it is disabled', async () => {
    const sub = await createTrigger(
      TEST_USER_ID,
      webhook('Lifecycle hook', { workspace_events: ['harness.created'] }),
    );
    await asOwner(request(server()).post('/api/v1/agents'))
      .send({ name: 'trigger-e2e-agent' })
      .expect(201);

    await waitFor(() => hits.length > 0);
    expect(hits[0].headers['x-thinker-event']).toBe('harness.created');
    const body = JSON.parse(hits[0].body);
    expect(body).toMatchObject({
      'event.type': 'harness.created',
      'harness.name': 'trigger-e2e-agent',
      'workspace.id': TEST_TENANT_ID,
      'trigger.name': 'Lifecycle hook',
    });
    const events = await waitFor(async () => {
      const res = await asOwner(
        request(server()).get(`/api/v1/triggers/events?trigger_id=${sub.id}&status=delivered`),
      );
      return res.body.events.length > 0 ? res.body.events : false;
    });
    expect(events[0]).toMatchObject({
      event_type: 'harness.created',
      agent_name: 'trigger-e2e-agent',
    });

    await asOwner(request(server()).patch(`/api/v1/triggers/${sub.id}`))
      .send({ enabled: false })
      .expect(200);
    hits.length = 0;
    await asOwner(request(server()).post('/api/v1/agents'))
      .send({ name: 'trigger-e2e-agent-2' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 1200));
    expect(hits).toHaveLength(0);
  });

  it('binds a trigger to a harness event and reads the binding back', async () => {
    const trigger = await createTrigger(TEST_USER_ID, webhook('Bound hook'));
    const put = await asOwner(request(server()).put('/api/v1/agents/test-agent/triggers'))
      .send({
        bindings: [
          { trigger_id: trigger.id, events: ['limit.alert', 'limit.alert', 'limit.block'] },
        ],
      })
      .expect(200);
    expect(put.body.bindings).toEqual([
      { trigger_id: trigger.id, events: ['limit.alert', 'limit.block'] },
    ]);
    const get = await asOwner(request(server()).get('/api/v1/agents/test-agent/triggers')).expect(
      200,
    );
    expect(get.body.bindings).toEqual(put.body.bindings);
    const list = await asOwner(request(server()).get('/api/v1/triggers')).expect(200);
    expect(list.body.triggers.find((t: { id: string }) => t.id === trigger.id).harness_count).toBe(
      1,
    );

    await asOwner(request(server()).put('/api/v1/agents/test-agent/triggers'))
      .send({ bindings: [{ trigger_id: trigger.id, events: ['harness.created'] }] })
      .expect(400);
    await asOwner(request(server()).put('/api/v1/agents/ghost/triggers'))
      .send({ bindings: [] })
      .expect(404);

    await asOwner(request(server()).put('/api/v1/agents/test-agent/triggers'))
      .send({ bindings: [] })
      .expect(200);
    const cleared = await asOwner(
      request(server()).get('/api/v1/agents/test-agent/triggers'),
    ).expect(200);
    expect(cleared.body.bindings).toEqual([]);
  });
});

describe('tenant isolation', () => {
  let foreignTrigger: string;
  let foreignEvent: string;
  let ownEvent: string;

  beforeAll(async () => {
    foreignTrigger = (await createTrigger(OUTSIDER, webhook('Foreign hook'))).id;
    await as(OUTSIDER, request(server()).post(`/api/v1/triggers/${foreignTrigger}/test`))
      .send({})
      .expect(201);
    const events = await as(OUTSIDER, request(server()).get('/api/v1/triggers/events')).expect(200);
    foreignEvent = events.body.events[0].id;

    const own = await createTrigger(TEST_USER_ID, webhook('Own hook for isolation'));
    await asOwner(request(server()).post(`/api/v1/triggers/${own.id}/test`))
      .send({})
      .expect(201);
    const mine = await asOwner(
      request(server()).get(`/api/v1/triggers/events?trigger_id=${own.id}`),
    ).expect(200);
    ownEvent = mine.body.events[0].id;
  });

  it('shows each organization only its own triggers', async () => {
    const outsider = await as(OUTSIDER, request(server()).get('/api/v1/triggers')).expect(200);
    expect(outsider.body.triggers.map((t: { name: string }) => t.name)).toEqual(['Foreign hook']);

    const owner = await asOwner(request(server()).get('/api/v1/triggers')).expect(200);
    const ownerNames = owner.body.triggers.map((t: { name: string }) => t.name);
    expect(ownerNames).not.toContain('Foreign hook');
    expect(ownerNames).toContain('Own hook for isolation');
  });

  it('shows each organization only its own events', async () => {
    const outsider = await as(OUTSIDER, request(server()).get('/api/v1/triggers/events')).expect(
      200,
    );
    expect(outsider.body.events.map((e: { id: string }) => e.id)).toEqual([foreignEvent]);

    const owner = await asOwner(request(server()).get('/api/v1/triggers/events?limit=200')).expect(
      200,
    );
    const ids = owner.body.events.map((e: { id: string }) => e.id);
    expect(ids).toContain(ownEvent);
    expect(ids).not.toContain(foreignEvent);
  });

  it('does not let a trigger_id filter reach into another organization', async () => {
    const res = await asOwner(
      request(server()).get(`/api/v1/triggers/events?trigger_id=${foreignTrigger}`),
    ).expect(200);
    expect(res.body.events).toEqual([]);
  });

  it('hides foreign events by id and refuses to retry them', async () => {
    await asOwner(request(server()).get(`/api/v1/triggers/events/${foreignEvent}`)).expect(404);
    await as(OUTSIDER, request(server()).get(`/api/v1/triggers/events/${ownEvent}`)).expect(404);

    // Fail the foreign event so a retry would otherwise be valid.
    await ds.query(`UPDATE trigger_events SET status = 'failed' WHERE id = $1`, [foreignEvent]);
    await asOwner(request(server()).post(`/api/v1/triggers/events/${foreignEvent}/retry`)).expect(
      400,
    );
    const [row] = await ds.query(`SELECT status FROM trigger_events WHERE id = $1`, [foreignEvent]);
    expect(row.status).toBe('failed');
  });

  it('cannot update, delete or test a foreign trigger', async () => {
    await asOwner(request(server()).patch(`/api/v1/triggers/${foreignTrigger}`))
      .send({ name: 'taken over' })
      .expect(404);
    await asOwner(request(server()).delete(`/api/v1/triggers/${foreignTrigger}`)).expect(404);
    await asOwner(request(server()).post(`/api/v1/triggers/${foreignTrigger}/test`))
      .send({})
      .expect(404);
    const [row] = await ds.query(`SELECT name FROM triggers WHERE id = $1`, [foreignTrigger]);
    expect(row.name).toBe('Foreign hook');
  });

  it('cannot bind a foreign trigger to a harness', async () => {
    const res = await asOwner(request(server()).put('/api/v1/agents/test-agent/triggers'))
      .send({ bindings: [{ trigger_id: foreignTrigger, events: ['limit.alert'] }] })
      .expect(400);
    expect(res.body.message).toEqual(['unknown trigger']);
  });

  it('refuses to act inside an organization the caller does not belong to', async () => {
    await as(
      TEST_USER_ID,
      request(server()).get('/api/v1/triggers').set('x-thinker-organization', OTHER_ORG),
    ).expect(403);
    await as(
      OUTSIDER,
      request(server())
        .get('/api/v1/triggers/events')
        .set('x-thinker-organization', TEST_TENANT_ID),
    ).expect(403);
  });

  it('allows the same trigger name in different organizations', async () => {
    await createTrigger(OUTSIDER, webhook('Own hook for isolation'));
  });
});
