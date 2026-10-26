/**
 * A provider used by a virtual model's own chain (ADR 0004) cannot be
 * disconnected, disabled for the harness, or removed (custom provider) until
 * the route goes, the same way a tier route blocks it. The disable-impact
 * endpoint lists the affected virtual models next to the affected tiers.
 *
 * Virtual model rows are seeded straight into the table so the routes are
 * deterministic; providers go through the real API.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { ModelRoute } from 'thinker-shared';
import { createTestApp, TEST_AGENT_ID, TEST_API_KEY, TEST_TENANT_ID } from './helpers';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';

let app: INestApplication;
let ds: DataSource;

const AGENT = 'test-agent';
const SECOND_AGENT = 'guard-second';
const USER_B = 'guard-user-b';
const B_AGENT = 'guard-b-agent';

const api = () => request(app.getHttpServer());
const asA = (r: request.Test) => r.set('x-api-key', TEST_API_KEY);
const asB = (r: request.Test) => r.set('x-api-key', TEST_API_KEY).set('x-test-user-id', USER_B);

const route = (provider: string, model: string): ModelRoute => ({
  provider,
  authType: 'api_key',
  model,
});

let secondAgentId: string;
let bAgentId: string;
let bTenantId: string;

let nextSortOrder = 0;

async function seedVirtual(row: {
  id: string;
  tenantId?: string;
  agentId?: string;
  name: string;
  enabled?: boolean;
  override?: ModelRoute | null;
  fallbacks?: ModelRoute[] | null;
  continueOnDefault?: boolean;
}): Promise<void> {
  await ds.query(
    `INSERT INTO virtual_models
       (id, tenant_id, agent_id, name, sort_order, enabled, override_route, fallback_routes, continue_on_default)
     VALUES ($1, $2, $3, $4, $9, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      row.id,
      row.tenantId ?? TEST_TENANT_ID,
      row.agentId ?? TEST_AGENT_ID,
      row.name,
      row.enabled ?? true,
      row.override ? JSON.stringify(row.override) : null,
      row.fallbacks ? JSON.stringify(row.fallbacks) : null,
      row.continueOnDefault ?? false,
      // Publish order follows seeding order, so "first match" is deterministic.
      nextSortOrder++,
    ],
  );
  const cache = app.get(RoutingCacheService);
  cache.invalidateAgent(row.agentId ?? TEST_AGENT_ID);
}

async function dropVirtual(id: string): Promise<void> {
  const rows: Array<{ agent_id: string }> = await ds.query(
    `SELECT agent_id FROM virtual_models WHERE id = $1`,
    [id],
  );
  await ds.query(`DELETE FROM virtual_models WHERE id = $1`, [id]);
  // The REST guard reads virtual models through the routing cache.
  for (const row of rows) app.get(RoutingCacheService).invalidateAgent(row.agent_id);
}

async function providerId(tenantId: string, provider: string): Promise<string> {
  const rows: Array<{ id: string }> = await ds.query(
    `SELECT id FROM tenant_providers WHERE tenant_id = $1 AND provider = $2 AND is_active = true`,
    [tenantId, provider],
  );
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

async function isActive(tenantId: string, provider: string): Promise<boolean> {
  const rows: Array<{ is_active: boolean }> = await ds.query(
    `SELECT is_active FROM tenant_providers WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider],
  );
  return rows.some((r) => r.is_active);
}

async function connect(as: typeof asA, agent: string, provider: string): Promise<void> {
  await as(api().post(`/api/v1/routing/${agent}/providers`))
    .send({ provider, apiKey: `sk-${provider}-guard-e2e-key-000000` })
    .expect(201);
}

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);

  const second = await asA(api().post('/api/v1/agents')).send({ name: SECOND_AGENT }).expect(201);
  secondAgentId = second.body.agent.id as string;
  const b = await asB(api().post('/api/v1/agents')).send({ name: B_AGENT }).expect(201);
  bAgentId = b.body.agent.id as string;
  const bRows: Array<{ tenant_id: string }> = await ds.query(
    `SELECT tenant_id FROM agents WHERE id = $1`,
    [bAgentId],
  );
  bTenantId = bRows[0].tenant_id;
  expect(bTenantId).not.toBe(TEST_TENANT_ID);

  await connect(asA, AGENT, 'openai');
  await connect(asA, AGENT, 'deepseek');
  await connect(asA, AGENT, 'mistral');
  await connect(asB, B_AGENT, 'openai');
}, 60000);

afterAll(async () => {
  await app.close();
});

describe('virtual models block provider disconnect, disable and removal', () => {
  it('lists the affected virtual models in the disable impact', async () => {
    await seedVirtual({
      id: 'g-flash',
      name: 'deepseek/flash',
      override: route('openai', 'gpt-4o'),
    });
    await seedVirtual({
      id: 'g-cheap',
      name: 'cheap',
      enabled: false,
      override: route('deepseek', 'deepseek-chat'),
      fallbacks: [route('deepseek', 'deepseek-reasoner'), route('openai', 'gpt-4o-mini')],
    });
    // Continuing on Default is not a direct use.
    await seedVirtual({
      id: 'g-default',
      name: 'on-default',
      override: route('deepseek', 'deepseek-chat'),
      continueOnDefault: true,
    });

    const openaiId = await providerId(TEST_TENANT_ID, 'openai');
    const res = await asA(
      api().get(`/api/v1/agents/${AGENT}/enabled-providers/${openaiId}/impact`),
    ).expect(200);

    expect(res.body.affected_tiers).toEqual([]);
    expect(res.body.affected_virtual_models).toEqual([
      expect.objectContaining({
        id: 'g-flash',
        name: 'deepseek/flash',
        agent: AGENT,
        position: 'primary',
      }),
      expect.objectContaining({
        id: 'g-cheap',
        name: 'cheap',
        agent: AGENT,
        position: 'fallback 2',
      }),
    ]);
  });

  it('blocks disabling the provider for the harness (409) and keeps the access row', async () => {
    const openaiId = await providerId(TEST_TENANT_ID, 'openai');
    const res = await asA(
      api().delete(`/api/v1/agents/${AGENT}/enabled-providers/${openaiId}`),
    ).expect(409);
    expect(res.body.message).toContain('virtual model "deepseek/flash", primary: gpt-4o');

    const rows = await ds.query(
      `SELECT 1 FROM agent_enabled_providers WHERE agent_id = $1 AND tenant_provider_id = $2`,
      [TEST_AGENT_ID, openaiId],
    );
    expect(rows).toHaveLength(1);
  });

  it('blocks disconnecting the provider (409) and keeps it active', async () => {
    const res = await asA(api().delete(`/api/v1/routing/${AGENT}/providers/openai`)).expect(409);
    expect(res.body.message).toContain('Cannot disconnect provider');
    expect(res.body.message).toContain('virtual model "deepseek/flash"');
    expect(await isActive(TEST_TENANT_ID, 'openai')).toBe(true);
  });

  it('a disabled virtual model alone, in a fallback, still blocks', async () => {
    await dropVirtual('g-flash');
    const res = await asA(api().delete(`/api/v1/routing/${AGENT}/providers/openai`)).expect(409);
    expect(res.body.message).toContain('virtual model "cheap", fallback 2: gpt-4o-mini');

    const openaiId = await providerId(TEST_TENANT_ID, 'openai');
    await asA(api().delete(`/api/v1/agents/${AGENT}/enabled-providers/${openaiId}`)).expect(409);
  });

  it('per-harness disable only looks at that harness; disconnect looks at the whole tenant', async () => {
    // The second agent has no virtual model on openai: disabling it there passes.
    const openaiId = await providerId(TEST_TENANT_ID, 'openai');
    await asA(api().delete(`/api/v1/agents/${SECOND_AGENT}/enabled-providers/${openaiId}`)).expect(
      200,
    );
    await asA(api().put(`/api/v1/agents/${SECOND_AGENT}/enabled-providers/${openaiId}`)).expect(
      200,
    );

    // A virtual on the second agent blocks a tenant-wide disconnect issued from the first.
    await seedVirtual({
      id: 'g-second',
      agentId: secondAgentId,
      name: 'second-model',
      override: route('mistral', 'mistral-large'),
    });
    const res = await asA(api().delete(`/api/v1/routing/${AGENT}/providers/mistral`)).expect(409);
    expect(res.body.message).toContain(`virtual model "second-model", primary: mistral-large`);
    await dropVirtual('g-second');
  });

  it("another tenant's virtual models never block this tenant", async () => {
    await seedVirtual({
      id: 'g-tenant-b',
      tenantId: bTenantId,
      agentId: bAgentId,
      name: 'b-model',
      override: route('openai', 'gpt-4o'),
    });
    await dropVirtual('g-cheap');

    await asA(api().delete(`/api/v1/routing/${AGENT}/providers/openai`)).expect(200);
    expect(await isActive(TEST_TENANT_ID, 'openai')).toBe(false);
    // Tenant B keeps its own connection, and its own guard still holds.
    expect(await isActive(bTenantId, 'openai')).toBe(true);
    await asB(api().delete(`/api/v1/routing/${B_AGENT}/providers/openai`)).expect(409);
    await dropVirtual('g-tenant-b');
  });

  it('blocks removing a custom provider used by a virtual model', async () => {
    const created = await asA(api().post(`/api/v1/routing/${AGENT}/custom-providers`))
      .send({
        name: 'Guard Custom',
        base_url: 'https://api.groq.com/openai/v1',
        apiKey: 'gsk_guard_test_key_12345',
        models: [{ model_name: 'guard-model' }],
      })
      .expect(201);
    const customId = created.body.id as string;

    await seedVirtual({
      id: 'g-custom',
      name: 'custom-virtual',
      override: route('anthropic', 'claude'),
      fallbacks: [route(`custom:${customId}`, 'guard-model')],
    });

    const res = await asA(
      api().delete(`/api/v1/routing/${AGENT}/custom-providers/${customId}`),
    ).expect(409);
    expect(res.body.message).toContain('virtual model "custom-virtual", fallback 1: guard-model');
    const still = await ds.query(`SELECT 1 FROM custom_providers WHERE id = $1`, [customId]);
    expect(still).toHaveLength(1);

    await dropVirtual('g-custom');
    await asA(api().delete(`/api/v1/routing/${AGENT}/custom-providers/${customId}`)).expect(200);
    const gone = await ds.query(`SELECT 1 FROM custom_providers WHERE id = $1`, [customId]);
    expect(gone).toHaveLength(0);
  });

  it('still disconnects a provider nobody routes to (regression)', async () => {
    // g-default continues on Default and points at deepseek only.
    await asA(api().delete(`/api/v1/routing/${AGENT}/providers/mistral`)).expect(200);
    expect(await isActive(TEST_TENANT_ID, 'mistral')).toBe(false);
  });

  it('the impact endpoint is empty once no route uses the provider', async () => {
    await dropVirtual('g-default');
    const deepseekId = await providerId(TEST_TENANT_ID, 'deepseek');
    const res = await asA(
      api().get(`/api/v1/agents/${AGENT}/enabled-providers/${deepseekId}/impact`),
    ).expect(200);
    expect(res.body).toEqual({ affected_tiers: [], affected_virtual_models: [] });
    await asA(api().delete(`/api/v1/agents/${AGENT}/enabled-providers/${deepseekId}`)).expect(200);
  });
});

describe('key renames and inactive key deletion follow virtual model pins', () => {
  const pinned = (label: string, model: string): ModelRoute => ({
    provider: 'anthropic',
    authType: 'api_key',
    model,
    keyLabel: label,
  });

  async function routesOf(id: string) {
    const rows: Array<{ override_route: ModelRoute | null; fallback_routes: ModelRoute[] | null }> =
      await ds.query(`SELECT override_route, fallback_routes FROM virtual_models WHERE id = $1`, [
        id,
      ]);
    return rows[0];
  }

  it('renaming a key rewrites the pin on virtual models of the same tenant only', async () => {
    await asA(api().post(`/api/v1/routing/${AGENT}/providers`))
      .send({ provider: 'anthropic', apiKey: 'sk-ant-guard-default-000000' })
      .expect(201);
    await asA(api().post(`/api/v1/routing/${AGENT}/providers`))
      .send({ provider: 'anthropic', apiKey: 'sk-ant-guard-work-000000', label: 'Work' })
      .expect(201);
    await seedVirtual({
      id: 'g-pin',
      name: 'pinned',
      enabled: false,
      override: pinned('Work', 'claude-a'),
      fallbacks: [pinned('Default', 'claude-b'), pinned('Work', 'claude-c')],
    });
    // Tenant B's row with the same label string must not be touched.
    await seedVirtual({
      id: 'g-pin-b',
      tenantId: bTenantId,
      agentId: bAgentId,
      name: 'pinned-b',
      override: pinned('Work', 'claude-a'),
    });
    // Warm the virtual-model cache so the rename has to invalidate it.
    await asA(api().get(`/api/v1/routing/${AGENT}/virtual-models`)).expect(200);

    await asA(api().patch(`/api/v1/routing/${AGENT}/providers/anthropic/keys/Work`))
      .send({ newLabel: 'Job' })
      .expect(200);

    const mine = await routesOf('g-pin');
    expect(mine.override_route?.keyLabel).toBe('Job');
    expect(mine.fallback_routes?.map((r) => r.keyLabel)).toEqual(['Default', 'Job']);
    expect((await routesOf('g-pin-b')).override_route?.keyLabel).toBe('Work');

    // The cached admin listing reflects the rename.
    const list = await asA(api().get(`/api/v1/routing/${AGENT}/virtual-models`)).expect(200);
    const view = (list.body as Array<{ id: string; override_route: ModelRoute | null }>).find(
      (v) => v.id === 'g-pin',
    );
    expect(view?.override_route?.keyLabel).toBe('Job');
  });

  it('deleting an inactive key clears the pin on virtual models', async () => {
    await ds.query(
      `UPDATE tenant_providers SET is_active = false
        WHERE tenant_id = $1 AND provider = 'anthropic' AND label = 'Job'`,
      [TEST_TENANT_ID],
    );
    await asA(
      api().delete(`/api/v1/routing/${AGENT}/providers/anthropic?authType=api_key&label=Job`),
    ).expect(200);

    const mine = await routesOf('g-pin');
    expect(mine.override_route?.keyLabel ?? null).toBeNull();
    expect(mine.fallback_routes?.map((r) => r.keyLabel ?? null)).toEqual(['Default', null]);
    expect((await routesOf('g-pin-b')).override_route?.keyLabel).toBe('Work');
    await dropVirtual('g-pin');
    await dropVirtual('g-pin-b');
  });
});
