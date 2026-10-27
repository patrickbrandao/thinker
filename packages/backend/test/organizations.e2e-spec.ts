import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestApp, TEST_API_KEY, TEST_TENANT_ID, TEST_USER_ID } from './helpers';

/**
 * Organizations, roles and accounts (ADR 0006). The fixture user owns
 * TEST_TENANT_ID through the legacy owner_user_id; the other users get
 * memberships here. Accounts with temporary passwords are created by Better
 * Auth, which these tests do not run, so they use existing "user" rows.
 */
const ADMIN = 'org-admin-user';
const MEMBER = 'org-member-user';
const VIEWER = 'org-viewer-user';
const OUTSIDER = 'org-outsider-user';
const OTHER_ORG = 'org-other-tenant';

let app: INestApplication;
let ds: DataSource;

const as = (userId: string, req: request.Test, orgId?: string) => {
  const r = req.set('x-api-key', TEST_API_KEY).set('x-test-user-id', userId);
  return orgId ? r.set('x-thinker-organization', orgId) : r;
};

beforeAll(async () => {
  app = await createTestApp();
  ds = app.get(DataSource);
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
});

describe('organization context and roles', () => {
  it('reports the active organization and role on /me', async () => {
    const res = await as(MEMBER, request(app.getHttpServer()).get('/api/v1/me')).expect(200);
    expect(res.body.organization).toMatchObject({ id: TEST_TENANT_ID, role: 'member' });
    expect(res.body.isInstanceAdmin).toBe(false);
  });

  it('refuses an organization the user does not belong to', async () => {
    await as(MEMBER, request(app.getHttpServer()).get('/api/v1/agents'), OTHER_ORG).expect(403);
  });

  it('keeps viewers read-only', async () => {
    await as(VIEWER, request(app.getHttpServer()).get('/api/v1/agents')).expect(200);
    const res = await as(VIEWER, request(app.getHttpServer()).post('/api/v1/agents'))
      .send({ name: 'viewer-agent' })
      .expect(403);
    expect(res.body.code).toBe('insufficient_role');
  });

  it('lets members create agents but not touch providers', async () => {
    const created = await as(MEMBER, request(app.getHttpServer()).post('/api/v1/agents')).send({
      name: 'member-agent',
    });
    expect(created.status).not.toBe(403);
    await as(
      MEMBER,
      request(app.getHttpServer()).post('/api/v1/routing/test-agent/custom-providers/probe'),
    )
      .send({})
      .expect(403);
    const asAdmin = await as(
      ADMIN,
      request(app.getHttpServer()).post('/api/v1/routing/test-agent/custom-providers/probe'),
    ).send({});
    expect(asAdmin.status).not.toBe(403);
  });
});

describe('local runners and private URLs (#78, #102)', () => {
  it('keeps local runners to owners and the instance admin by default', async () => {
    const res = await as(
      ADMIN,
      request(app.getHttpServer()).post('/api/v1/routing/test-agent/providers'),
    )
      .send({ provider: 'ollama', authType: 'local' })
      .expect(403);
    expect(res.body.code).toBe('private_destination_forbidden');
  });
});

describe('organizations API', () => {
  it('lists the caller organizations with their role', async () => {
    const res = await as(
      OUTSIDER,
      request(app.getHttpServer()).get('/api/v1/organizations'),
    ).expect(200);
    expect(res.body.organizations).toEqual([{ id: OTHER_ORG, name: 'Other', role: 'owner' }]);
  });

  it('only lets the instance admin create organizations', async () => {
    await as(MEMBER, request(app.getHttpServer()).post('/api/v1/organizations'))
      .send({ name: 'Nope' })
      .expect(403);
    await ds.query(
      `INSERT INTO user_profiles (user_id, is_instance_admin) VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET is_instance_admin = true`,
      [TEST_USER_ID],
    );
    const res = await as(TEST_USER_ID, request(app.getHttpServer()).post('/api/v1/organizations'))
      .send({ name: 'Acme' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Acme', role: 'owner' });
    // The instance admin enters any organization as owner.
    const me = await as(
      TEST_USER_ID,
      request(app.getHttpServer()).get('/api/v1/me'),
      OTHER_ORG,
    ).expect(200);
    expect(me.body.organization).toMatchObject({ id: OTHER_ORG, role: 'owner' });
  });

  it('serves agent keys of an organization the instance admin created', async () => {
    const server = app.getHttpServer();
    const org = await as(TEST_USER_ID, request(server).post('/api/v1/organizations'))
      .send({ name: 'Keys Org' })
      .expect(201);
    const agent = await as(TEST_USER_ID, request(server).post('/api/v1/agents'), org.body.id)
      .send({ name: 'keys-org-agent' })
      .expect(201);
    expect(agent.body.apiKey).toMatch(/^thk_/);
    await request(server).get('/v1/models').set('x-api-key', agent.body.apiKey).expect(200);
  });

  it('manages members by role and protects the last owner', async () => {
    const server = app.getHttpServer();
    const add = await as(ADMIN, request(server).post(`/api/v1/organizations/${OTHER_ORG}/members`))
      .send({ email: `${MEMBER}@test.local`, role: 'member' })
      .expect(403); // ADMIN is not a member of OTHER_ORG
    expect(add.body.code).toBe('not_a_member');

    const added = await as(
      OUTSIDER,
      request(server).post(`/api/v1/organizations/${OTHER_ORG}/members`),
    )
      .send({ email: `${MEMBER}@TEST.local`, role: 'viewer' })
      .expect(201);
    expect(added.body).toMatchObject({
      member: { userId: MEMBER, role: 'viewer' },
      temporaryPassword: null,
    });

    await as(
      OUTSIDER,
      request(server).delete(`/api/v1/organizations/${OTHER_ORG}/members/${OUTSIDER}`),
    ).expect(409);
    await as(
      MEMBER,
      request(server).patch(`/api/v1/organizations/${OTHER_ORG}/members/${MEMBER}`),
      OTHER_ORG,
    )
      .send({ role: 'owner' })
      .expect(403);

    const list = await as(
      MEMBER,
      request(server).get(`/api/v1/organizations/${OTHER_ORG}/members`),
    ).expect(200);
    expect(list.body.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [MEMBER, OUTSIDER].sort(),
    );
  });

  it('switches the saved active organization', async () => {
    const server = app.getHttpServer();
    await as(MEMBER, request(server).put('/api/v1/me/active-organization'))
      .send({ organizationId: OTHER_ORG })
      .expect(200);
    const me = await as(MEMBER, request(server).get('/api/v1/me')).expect(200);
    expect(me.body.organization).toMatchObject({ id: OTHER_ORG, role: 'viewer' });
  });

  it('keeps instance-admin endpoints closed to everyone else', async () => {
    await as(ADMIN, request(app.getHttpServer()).get('/api/v1/admin/users')).expect(403);
    const res = await as(
      TEST_USER_ID,
      request(app.getHttpServer()).get('/api/v1/admin/users'),
    ).expect(200);
    const member = res.body.users.find((u: { id: string }) => u.id === MEMBER);
    expect(member.organizations.map((o: { id: string }) => o.id).sort()).toEqual(
      [TEST_TENANT_ID, OTHER_ORG].sort(),
    );
  });
});

describe('temporary password', () => {
  it('blocks everything but /me until the password changes', async () => {
    await ds.query(
      `INSERT INTO user_profiles (user_id, must_change_password) VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET must_change_password = true`,
      [VIEWER],
    );
    const blocked = await as(VIEWER, request(app.getHttpServer()).get('/api/v1/agents')).expect(
      403,
    );
    expect(blocked.body.code).toBe('password_change_required');
    const me = await as(VIEWER, request(app.getHttpServer()).get('/api/v1/me')).expect(200);
    expect(me.body.mustChangePassword).toBe(true);
  });
});
