import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, TEST_API_KEY, TEST_OTLP_KEY } from './helpers';
import { IpPrefixesModule } from '../src/ip-prefixes/ip-prefixes.module';
import { clearIpRestrictionCache } from '../src/ip-prefixes/ip-restriction-cache';

/**
 * Many keys per harness (the seeded key stays the primary) and the per-harness
 * source-IP restriction. Requests come from loopback, a default trusted proxy,
 * so X-Forwarded-For sets the client address the guard judges.
 */
describe('Harness keys and IP prefix lists (e2e)', () => {
  let app: INestApplication;
  const admin = { 'x-api-key': TEST_API_KEY };
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  beforeAll(async () => {
    app = await createTestApp({ extraImports: [IpPrefixesModule] });
  });

  afterAll(async () => {
    await app?.close();
  });

  const api = () => request(app.getHttpServer());
  const gateway = (key: string, ip = '198.51.100.10') =>
    api().get('/v1/key').set('Authorization', `Bearer ${key}`).set('X-Forwarded-For', ip);

  let extraKey = '';
  let extraKeyId = '';

  it('lists the seeded key as the primary key', async () => {
    const res = await api().get('/api/v1/agents/test-agent/keys').set(admin).expect(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({ isPrimary: true, status: 'active', expiresAt: null });
  });

  it('creates an extra key that must expire and works alongside the primary', async () => {
    await api()
      .post('/api/v1/agents/test-agent/keys')
      .set(admin)
      .send({ name: 'ci' })
      .expect(400);
    await api()
      .post('/api/v1/agents/test-agent/keys')
      .set(admin)
      .send({ name: 'ci', expiresAt: days(400) })
      .expect(400);

    const res = await api()
      .post('/api/v1/agents/test-agent/keys')
      .set(admin)
      .send({ name: 'ci', expiresAt: days(30) })
      .expect(201);
    extraKey = res.body.apiKey;
    extraKeyId = res.body.key.id;
    expect(extraKey).toMatch(/^thk_/);
    expect(res.body.key).toMatchObject({ name: 'ci', isPrimary: false, status: 'active' });

    const self = await gateway(extraKey).expect(200);
    expect(self.body).toMatchObject({ object: 'key', name: 'ci', harness: 'test-agent', is_primary: false });
    expect(self.body.expires_at).toBeTruthy();
    await gateway(TEST_OTLP_KEY).expect(200);
  });

  it('disables (M007), re-enables and revokes the extra key', async () => {
    await api()
      .patch(`/api/v1/agents/test-agent/keys/${extraKeyId}`)
      .set(admin)
      .send({ disabled: true })
      .expect(200);
    const refused = await gateway(extraKey).expect(401);
    expect(refused.body.error.message).toContain('M007');

    await api()
      .patch(`/api/v1/agents/test-agent/keys/${extraKeyId}`)
      .set(admin)
      .send({ disabled: false })
      .expect(200);
    await gateway(extraKey).expect(200);

    const revoked = await api()
      .delete(`/api/v1/agents/test-agent/keys/${extraKeyId}`)
      .set(admin)
      .expect(200);
    expect(revoked.body.key.status).toBe('revoked');
    await gateway(extraKey).expect(401);
    await api()
      .patch(`/api/v1/agents/test-agent/keys/${extraKeyId}`)
      .set(admin)
      .send({ disabled: false })
      .expect(409);
  });

  it('never revokes the primary key', async () => {
    const list = await api().get('/api/v1/agents/test-agent/keys').set(admin).expect(200);
    const primary = list.body.keys.find((k: { isPrimary: boolean }) => k.isPrimary);
    await api().delete(`/api/v1/agents/test-agent/keys/${primary.id}`).set(admin).expect(409);
    await gateway(TEST_OTLP_KEY).expect(200);
  });

  it('restricts the source IP to the linked prefix lists (M008, 403)', async () => {
    await api()
      .post('/api/v1/ip-prefix-lists')
      .set(admin)
      .send({ name: 'Bad', entries: [{ prefix: 'example.com' }] })
      .expect(400);
    const list = await api()
      .post('/api/v1/ip-prefix-lists')
      .set(admin)
      .send({
        name: 'Office',
        entries: [{ prefix: '198.51.100.0/24', label: 'HQ' }, { prefix: '2001:db8::1' }],
      })
      .expect(201);
    expect(list.body.entries).toEqual([
      { prefix: '198.51.100.0/24', label: 'HQ' },
      { prefix: '2001:db8::1/128', label: null },
    ]);

    await api()
      .put('/api/v1/agents/test-agent/ip-restriction')
      .set(admin)
      .send({ enabled: true, listIds: [] })
      .expect(400);
    const set = await api()
      .put('/api/v1/agents/test-agent/ip-restriction')
      .set(admin)
      .send({ enabled: true, listIds: [list.body.id] })
      .expect(200);
    expect(set.body).toEqual({ enabled: true, listIds: [list.body.id] });

    await gateway(TEST_OTLP_KEY, '198.51.100.77').expect(200);
    await gateway(TEST_OTLP_KEY, '2001:db8::1').expect(200);
    const refused = await gateway(TEST_OTLP_KEY, '203.0.113.9').expect(403);
    expect(refused.body.error.message).toContain('M008');

    const busy = await api().delete(`/api/v1/ip-prefix-lists/${list.body.id}`).set(admin).expect(409);
    expect(busy.body.harnesses).toEqual([{ name: 'test-agent', displayName: 'Test Agent' }]);

    await api()
      .put('/api/v1/agents/test-agent/ip-restriction')
      .set(admin)
      .send({ enabled: false, listIds: [] })
      .expect(200);
    clearIpRestrictionCache();
    await gateway(TEST_OTLP_KEY, '203.0.113.9').expect(200);
    await api().delete(`/api/v1/ip-prefix-lists/${list.body.id}`).set(admin).expect(200);
  });
});
