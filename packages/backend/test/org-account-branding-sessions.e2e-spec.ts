/**
 * Organizations, own-account routes, branding, console and harness sessions,
 * end to end over HTTP, with cross-tenant isolation and 401 cases.
 *
 * The test app swaps the session guard for one that resolves users from
 * `organization_members` (see helpers.ts), so Better Auth never runs here:
 * account creation is covered by the unit specs, and the password change is
 * exercised through its validation and its "wrong current password" path.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MAX_LOG_RETENTION_DAYS } from '../src/config/recording-retention';
import {
  createTestApp,
  TEST_AGENT_ID,
  TEST_API_KEY,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from './helpers';

const OWNER = TEST_USER_ID; // owner of TEST_TENANT_ID
const ADMIN = 'oabs-admin';
const MEMBER = 'oabs-member';
const VIEWER = 'oabs-viewer';
const OUTSIDER = 'oabs-outsider'; // owner of ORG_B only
const ROOT = 'oabs-root'; // instance administrator, member of nothing
const ORG_B = 'oabs-org-b';

const BRANDING_ENV = ['THINKER_TITLE', 'THINKER_LOGO_URL', 'THINKER_HIDE_INFO'] as const;
const savedBranding: Record<string, string | undefined> = {};

let app: INestApplication;
let ds: DataSource;

const api = () => request(app.getHttpServer());
const as = (userId: string, req: request.Test, orgId?: string) => {
  const r = req.set('x-api-key', TEST_API_KEY).set('x-test-user-id', userId);
  return orgId ? r.set('x-thinker-organization', orgId) : r;
};

const minutesAgo = (n: number) => `now() - make_interval(mins => ${n})`;

beforeAll(async () => {
  for (const key of BRANDING_ENV) {
    savedBranding[key] = process.env[key];
    delete process.env[key];
  }
  app = await createTestApp();
  ds = app.get(DataSource);
  await ds.query(
    `CREATE TABLE IF NOT EXISTS "user" (
       id VARCHAR PRIMARY KEY, email VARCHAR, name VARCHAR,
       "emailVerified" BOOLEAN DEFAULT true, "createdAt" TIMESTAMP DEFAULT NOW()
     )`,
  );
  for (const id of [OWNER, ADMIN, MEMBER, VIEWER, OUTSIDER, ROOT]) {
    await ds.query(`INSERT INTO "user" (id, email, name) VALUES ($1, $2, $1)`, [
      id,
      `${id}@test.local`,
    ]);
  }
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES
       ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member'), ($1, $5, 'viewer')`,
    [TEST_TENANT_ID, OWNER, ADMIN, MEMBER, VIEWER],
  );
  await ds.query(
    `INSERT INTO tenants (id, name, organization_name, is_active) VALUES ($1, $1, 'Org B', true)`,
    [ORG_B],
  );
  await ds.query(
    `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [ORG_B, OUTSIDER],
  );
  await ds.query(
    `INSERT INTO user_profiles (user_id, is_instance_admin) VALUES ($1, true)
     ON CONFLICT (user_id) DO UPDATE SET is_instance_admin = true`,
    [ROOT],
  );
}, 60000);

afterAll(async () => {
  for (const key of BRANDING_ENV) {
    if (savedBranding[key] === undefined) delete process.env[key];
    else process.env[key] = savedBranding[key];
  }
  await app.close();
});

describe('authentication: no credential, no data', () => {
  const routes: Array<[method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string]> = [
    ['get', '/api/v1/organizations'],
    ['post', '/api/v1/organizations'],
    ['patch', `/api/v1/organizations/${TEST_TENANT_ID}`],
    ['delete', `/api/v1/organizations/${TEST_TENANT_ID}`],
    ['get', `/api/v1/organizations/${TEST_TENANT_ID}/log-retention`],
    ['patch', `/api/v1/organizations/${TEST_TENANT_ID}/log-retention`],
    ['get', `/api/v1/organizations/${TEST_TENANT_ID}/members`],
    ['post', `/api/v1/organizations/${TEST_TENANT_ID}/members`],
    ['patch', `/api/v1/organizations/${TEST_TENANT_ID}/members/${MEMBER}`],
    ['delete', `/api/v1/organizations/${TEST_TENANT_ID}/members/${MEMBER}`],
    ['post', '/api/v1/me/password'],
    ['put', '/api/v1/me/active-organization'],
    ['get', '/api/v1/admin/users'],
    ['post', '/api/v1/admin/users'],
    ['get', '/api/v1/sessions'],
    ['get', '/api/v1/sessions/anything'],
    ['get', '/api/v1/search?q=abc'],
    ['get', '/api/v1/alerts'],
    ['get', '/api/v1/topology'],
    ['put', '/api/v1/topology/positions'],
    ['delete', '/api/v1/topology/positions'],
  ];

  it.each(routes)('%s %s answers 401 without a credential', async (method, path) => {
    await api()[method](path).send({}).expect(401);
  });
});

describe('GET /api/v1/branding (public)', () => {
  it('answers without any credential, with the defaults', async () => {
    const res = await api().get('/api/v1/branding').expect(200);
    expect(res.body).toEqual({ title: 'Thinker', logoUrl: null, hideInfo: false });
  });

  it('reflects the environment, trimmed and case-insensitive for the boolean', async () => {
    process.env['THINKER_TITLE'] = '  Acme Gateway ';
    process.env['THINKER_LOGO_URL'] = ' https://cdn.example.com/logo.png ';
    process.env['THINKER_HIDE_INFO'] = ' TRUE ';
    try {
      const res = await api().get('/api/v1/branding').expect(200);
      expect(res.body).toEqual({
        title: 'Acme Gateway',
        logoUrl: 'https://cdn.example.com/logo.png',
        hideInfo: true,
      });
    } finally {
      for (const key of BRANDING_ENV) delete process.env[key];
    }
  });

  it('treats blank values as unset and any other boolean as false', async () => {
    process.env['THINKER_TITLE'] = '   ';
    process.env['THINKER_LOGO_URL'] = '';
    process.env['THINKER_HIDE_INFO'] = 'yes';
    try {
      const res = await api().get('/api/v1/branding').expect(200);
      expect(res.body).toEqual({ title: 'Thinker', logoUrl: null, hideInfo: false });
    } finally {
      for (const key of BRANDING_ENV) delete process.env[key];
    }
  });

  it('is also readable by a signed-in user, with the same content', async () => {
    const res = await as(VIEWER, api().get('/api/v1/branding')).expect(200);
    expect(res.body.title).toBe('Thinker');
  });
});

describe('POST /api/v1/me/password', () => {
  const change = (userId: string, body?: object) =>
    as(userId, api().post('/api/v1/me/password')).send(body ?? {});

  it('is not mounted under /organizations', async () => {
    await as(OWNER, api().post('/api/v1/organizations/password')).send({}).expect(404);
  });

  it.each([
    ['a missing body', undefined],
    ['an empty new password', { currentPassword: 'old-password-1', newPassword: '' }],
    ['a 7 character new password', { currentPassword: 'old-password-1', newPassword: '1234567' }],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await change(MEMBER, body).expect(400);
    expect(res.body.message).toMatch(/at least 8 characters/);
  });

  it('rejects reusing the current password', async () => {
    const res = await change(MEMBER, {
      currentPassword: 'same-password-1',
      newPassword: 'same-password-1',
    }).expect(400);
    expect(res.body.message).toMatch(/different/);
  });

  it('rejects a wrong current password and keeps the temporary-password flag', async () => {
    await ds.query(
      `INSERT INTO user_profiles (user_id, must_change_password) VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET must_change_password = true`,
      [VIEWER],
    );
    // The temporary-password gate lets this route through; the credential check fails.
    const res = await change(VIEWER, {
      currentPassword: 'definitely-wrong',
      newPassword: 'a-brand-new-password',
    }).expect(400);
    expect(res.body.message).toBe('The current password is wrong.');
    const [profile] = await ds.query(
      `SELECT must_change_password FROM user_profiles WHERE user_id = $1`,
      [VIEWER],
    );
    expect(profile.must_change_password).toBe(true);
    await ds.query(`UPDATE user_profiles SET must_change_password = false WHERE user_id = $1`, [
      VIEWER,
    ]);
  });
});

describe('PUT /api/v1/me/active-organization', () => {
  const switchTo = (userId: string, organizationId: unknown) =>
    as(userId, api().put('/api/v1/me/active-organization')).send({ organizationId });
  const activeOf = async (userId: string) =>
    (await as(userId, api().get('/api/v1/me')).expect(200)).body.organization;

  beforeAll(async () => {
    // MEMBER belongs to both organizations, with different roles.
    await ds.query(
      `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [ORG_B, MEMBER],
    );
  });

  it('switches between the organizations the user belongs to', async () => {
    await switchTo(MEMBER, ORG_B).expect(200, { ok: true });
    expect(await activeOf(MEMBER)).toMatchObject({ id: ORG_B, role: 'viewer' });
    await switchTo(MEMBER, TEST_TENANT_ID).expect(200, { ok: true });
    expect(await activeOf(MEMBER)).toMatchObject({ id: TEST_TENANT_ID, role: 'member' });
  });

  it('applies the role of the organization it switched to', async () => {
    await switchTo(MEMBER, ORG_B).expect(200);
    // As a viewer in ORG_B, creating an agent is refused.
    const res = await as(MEMBER, api().post('/api/v1/agents'))
      .send({ name: 'oabs-nope' })
      .expect(403);
    expect(res.body.code).toBe('insufficient_role');
    await switchTo(MEMBER, TEST_TENANT_ID).expect(200);
  });

  it('refuses an organization the user does not belong to, and keeps the saved choice', async () => {
    const res = await switchTo(VIEWER, ORG_B).expect(403);
    expect(res.body.code).toBe('not_a_member');
    expect(await activeOf(VIEWER)).toMatchObject({ id: TEST_TENANT_ID });
    const [profile] = await ds.query(
      `SELECT active_tenant_id FROM user_profiles WHERE user_id = $1`,
      [VIEWER],
    );
    expect(profile?.active_tenant_id ?? null).toBeNull();
  });

  it('cannot be used to enter another tenant by guessing its id', async () => {
    await switchTo(OUTSIDER, TEST_TENANT_ID).expect(403);
    expect(await activeOf(OUTSIDER)).toMatchObject({ id: ORG_B });
  });

  it('is 404 for an unknown organization', async () => {
    await switchTo(MEMBER, randomUUID()).expect(404);
  });

  it('is 404 for a deactivated organization, even for a former member', async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO tenants (id, name, organization_name, is_active) VALUES ($1, $1, 'Gone', false)`,
      [id],
    );
    await ds.query(
      `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, MEMBER],
    );
    await switchTo(MEMBER, id).expect(404);
  });

  it('lets the instance administrator enter any active organization', async () => {
    await switchTo(ROOT, ORG_B).expect(200, { ok: true });
    expect(await activeOf(ROOT)).toMatchObject({ id: ORG_B, role: 'owner' });
    await switchTo(ROOT, TEST_TENANT_ID).expect(200);
    expect(await activeOf(ROOT)).toMatchObject({ id: TEST_TENANT_ID, role: 'owner' });
  });

  it('answers 400 (not 500) when the organization id is missing', async () => {
    await as(MEMBER, api().put('/api/v1/me/active-organization')).send({}).expect(400);
  });
});

describe('organizations: rename, retention and deactivation', () => {
  it('lists only the organizations of the caller, never other tenants', async () => {
    const mine = await as(MEMBER, api().get('/api/v1/organizations')).expect(200);
    const ids = mine.body.organizations.map((o: { id: string }) => o.id);
    expect(ids).toContain(TEST_TENANT_ID);
    const outsider = await as(OUTSIDER, api().get('/api/v1/organizations')).expect(200);
    expect(outsider.body.organizations.map((o: { id: string }) => o.id)).toEqual([ORG_B]);
  });

  it('shows the instance administrator every active organization as owner', async () => {
    const res = await as(ROOT, api().get('/api/v1/organizations')).expect(200);
    const byId = new Map(
      res.body.organizations.map((o: { id: string; role: string }) => [o.id, o.role]),
    );
    expect(byId.get(TEST_TENANT_ID)).toBe('owner');
    expect(byId.get(ORG_B)).toBe('owner');
  });

  it('lets only the instance administrator create organizations, with a real name', async () => {
    await as(OWNER, api().post('/api/v1/organizations')).send({ name: 'Nope' }).expect(403);
    await as(ROOT, api().post('/api/v1/organizations')).send({ name: '   ' }).expect(400);
    await as(ROOT, api().post('/api/v1/organizations')).send({}).expect(400);
    const created = await as(ROOT, api().post('/api/v1/organizations'))
      .send({ name: '  Fresh Org ' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Fresh Org', role: 'owner' });
    const [member] = await ds.query(
      `SELECT role FROM organization_members WHERE tenant_id = $1 AND user_id = $2`,
      [created.body.id, ROOT],
    );
    expect(member.role).toBe('owner');
  });

  describe('rename', () => {
    const rename = (userId: string, orgId: string, name: unknown) =>
      as(userId, api().patch(`/api/v1/organizations/${orgId}`)).send({ name });

    it('needs the owner role', async () => {
      for (const user of [ADMIN, MEMBER, VIEWER]) {
        const res = await rename(user, TEST_TENANT_ID, 'Hijacked').expect(403);
        expect(res.body.code).toBe('insufficient_role');
      }
      const res = await rename(OWNER, TEST_TENANT_ID, '  Test Org Renamed ').expect(200);
      expect(res.body).toEqual({ id: TEST_TENANT_ID, name: 'Test Org Renamed' });
      await rename(OWNER, TEST_TENANT_ID, 'Test Org').expect(200);
    });

    it('refuses a blank name', async () => {
      await rename(OWNER, TEST_TENANT_ID, '  ').expect(400);
      await rename(OWNER, TEST_TENANT_ID, undefined).expect(400);
    });

    it('cannot touch an organization the caller is not a member of', async () => {
      const res = await rename(OUTSIDER, TEST_TENANT_ID, 'Hijacked').expect(403);
      expect(res.body.code).toBe('not_a_member');
      const [row] = await ds.query(`SELECT organization_name FROM tenants WHERE id = $1`, [
        TEST_TENANT_ID,
      ]);
      expect(row.organization_name).toBe('Test Org');
    });

    it('is 404 for an unknown organization', async () => {
      await rename(OWNER, randomUUID(), 'X').expect(404);
    });
  });

  describe('log retention', () => {
    const path = `/api/v1/organizations/${TEST_TENANT_ID}/log-retention`;

    it('is readable by every member, and by nobody outside', async () => {
      for (const user of [OWNER, ADMIN, MEMBER, VIEWER]) {
        const res = await as(user, api().get(path)).expect(200);
        expect(res.body).toEqual({ retention_days: null, default_days: expect.any(Number) });
      }
      const res = await as(OUTSIDER, api().get(path)).expect(403);
      expect(res.body.code).toBe('not_a_member');
    });

    it('is written by owners only', async () => {
      for (const user of [ADMIN, MEMBER, VIEWER]) {
        await as(user, api().patch(path)).send({ retention_days: 7 }).expect(403);
      }
      const res = await as(OWNER, api().patch(path)).send({ retention_days: 7 }).expect(200);
      expect(res.body.retention_days).toBe(7);
      expect((await as(VIEWER, api().get(path)).expect(200)).body.retention_days).toBe(7);
    });

    it.each([0, -3, 1.5, MAX_LOG_RETENTION_DAYS + 1, '10', true])(
      'rejects retention_days=%p with 400 and keeps the stored value',
      async (value) => {
        await as(OWNER, api().patch(path)).send({ retention_days: value }).expect(400);
        expect((await as(OWNER, api().get(path)).expect(200)).body.retention_days).toBe(7);
      },
    );

    it('accepts the upper bound, then null to follow the instance default again', async () => {
      const max = await as(OWNER, api().patch(path))
        .send({ retention_days: MAX_LOG_RETENTION_DAYS })
        .expect(200);
      expect(max.body.retention_days).toBe(MAX_LOG_RETENTION_DAYS);
      const reset = await as(OWNER, api().patch(path)).send({ retention_days: null }).expect(200);
      expect(reset.body.retention_days).toBeNull();
      await as(OWNER, api().patch(path)).send({}).expect(200); // absent means null too
    });

    it('is per organization', async () => {
      await as(OUTSIDER, api().patch(`/api/v1/organizations/${ORG_B}/log-retention`))
        .send({ retention_days: 3 })
        .expect(200);
      expect((await as(OWNER, api().get(path)).expect(200)).body.retention_days).toBeNull();
      await as(OUTSIDER, api().patch(`/api/v1/organizations/${ORG_B}/log-retention`))
        .send({ retention_days: null })
        .expect(200);
    });
  });

  describe('deactivation', () => {
    let orgId: string;
    const DELETER = 'oabs-deleter';
    const BYSTANDER = 'oabs-bystander';

    beforeAll(async () => {
      orgId = randomUUID();
      for (const id of [DELETER, BYSTANDER]) {
        await ds.query(`INSERT INTO "user" (id, email, name) VALUES ($1, $2, $1)`, [
          id,
          `${id}@test.local`,
        ]);
      }
      await ds.query(
        `INSERT INTO tenants (id, name, organization_name, is_active) VALUES ($1, $1, 'Doomed', true)`,
        [orgId],
      );
      await ds.query(
        `INSERT INTO organization_members (tenant_id, user_id, role) VALUES
           ($1, $2, 'owner'), ($1, $3, 'admin')`,
        [orgId, DELETER, BYSTANDER],
      );
    });

    it('is refused for non-owners and for non-members', async () => {
      await as(BYSTANDER, api().delete(`/api/v1/organizations/${orgId}`)).expect(403);
      await as(OUTSIDER, api().delete(`/api/v1/organizations/${orgId}`)).expect(403);
    });

    it('keeps the data but removes the organization from every listing and from access', async () => {
      await as(DELETER, api().delete(`/api/v1/organizations/${orgId}`)).expect(200, { ok: true });
      const [row] = await ds.query(`SELECT is_active FROM tenants WHERE id = $1`, [orgId]);
      expect(row.is_active).toBe(false);
      for (const user of [DELETER, BYSTANDER]) {
        const list = await as(user, api().get('/api/v1/organizations')).expect(200);
        expect(list.body.organizations).toEqual([]);
        await as(user, api().get('/api/v1/agents'), orgId).expect(403);
      }
      const rootList = await as(ROOT, api().get('/api/v1/organizations')).expect(200);
      expect(rootList.body.organizations.map((o: { id: string }) => o.id)).not.toContain(orgId);
      await as(DELETER, api().get(`/api/v1/organizations/${orgId}/members`)).expect(404);
      await as(DELETER, api().delete(`/api/v1/organizations/${orgId}`)).expect(404);
    });
  });
});

describe('organization members', () => {
  const base = `/api/v1/organizations/${TEST_TENANT_ID}/members`;
  const NEWBIE = 'oabs-newbie';

  beforeAll(async () => {
    await ds.query(`INSERT INTO "user" (id, email, name) VALUES ($1, $2, $1)`, [
      NEWBIE,
      `${NEWBIE}@test.local`,
    ]);
  });

  const memberRole = async (orgId: string, userId: string) => {
    const [row] = await ds.query(
      `SELECT role FROM organization_members WHERE tenant_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    return row?.role as string | undefined;
  };

  it('lists members to any member, never to a non-member', async () => {
    const res = await as(VIEWER, api().get(base)).expect(200);
    expect(res.body.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [OWNER, ADMIN, MEMBER, VIEWER].sort(),
    );
    expect(res.body.members[0]).toEqual(
      expect.objectContaining({
        email: expect.stringContaining('@test.local'),
        mustChangePassword: false,
      }),
    );
    const denied = await as(OUTSIDER, api().get(base)).expect(403);
    expect(denied.body.code).toBe('not_a_member');
  });

  it('adds an existing account by email (case-insensitive) for admins and owners only', async () => {
    await as(MEMBER, api().post(base))
      .send({ email: `${NEWBIE}@test.local`, role: 'viewer' })
      .expect(403);
    await as(VIEWER, api().post(base))
      .send({ email: `${NEWBIE}@test.local`, role: 'viewer' })
      .expect(403);
    const res = await as(ADMIN, api().post(base))
      .send({ email: `${NEWBIE.toUpperCase()}@TEST.local`, role: 'viewer' })
      .expect(201);
    expect(res.body).toMatchObject({
      member: { userId: NEWBIE, role: 'viewer' },
      temporaryPassword: null,
    });
    expect(await memberRole(TEST_TENANT_ID, NEWBIE)).toBe('viewer');
  });

  it('rejects a duplicate, a bad role, a bad email and an admin granting owner', async () => {
    const dup = await as(ADMIN, api().post(base))
      .send({ email: `${NEWBIE}@test.local`, role: 'member' })
      .expect(409);
    expect(dup.body.message).toMatch(/already a member/);
    expect(await memberRole(TEST_TENANT_ID, NEWBIE)).toBe('viewer');

    await as(ADMIN, api().post(base))
      .send({ email: `${MEMBER}@test.local`, role: 'root' })
      .expect(400);
    await as(ADMIN, api().post(base)).send({ email: 'not-an-email', role: 'viewer' }).expect(400);
    await as(ADMIN, api().post(base)).send({ role: 'viewer' }).expect(400);
    const owner = await as(ADMIN, api().post(base))
      .send({ email: `${OUTSIDER}@test.local`, role: 'owner' })
      .expect(403);
    expect(owner.body.code).toBe('insufficient_role');
    expect(await memberRole(TEST_TENANT_ID, OUTSIDER)).toBeUndefined();
  });

  it('changes roles within what the caller may grant', async () => {
    const path = `${base}/${NEWBIE}`;
    const up = await as(ADMIN, api().patch(path)).send({ role: 'member' }).expect(200);
    expect(up.body.member).toMatchObject({ userId: NEWBIE, role: 'member' });
    await as(MEMBER, api().patch(path)).send({ role: 'admin' }).expect(403);
    await as(ADMIN, api().patch(path)).send({ role: 'owner' }).expect(403); // admins cannot promote to owner
    await as(ADMIN, api().patch(path)).send({ role: 'nonsense' }).expect(400);
    await as(ADMIN, api().patch(`${base}/${randomUUID()}`))
      .send({ role: 'viewer' })
      .expect(404);
    expect(await memberRole(TEST_TENANT_ID, NEWBIE)).toBe('member');
  });

  it('keeps admins away from the owner role', async () => {
    await as(ADMIN, api().patch(`${base}/${OWNER}`))
      .send({ role: 'viewer' })
      .expect(403);
    await as(ADMIN, api().delete(`${base}/${OWNER}`)).expect(403);
    expect(await memberRole(TEST_TENANT_ID, OWNER)).toBe('owner');
  });

  it('protects the last owner from demotion and removal, but not a second owner', async () => {
    await as(OWNER, api().patch(`${base}/${OWNER}`))
      .send({ role: 'admin' })
      .expect(409);
    await as(OWNER, api().delete(`${base}/${OWNER}`)).expect(409);
    await as(OWNER, api().patch(`${base}/${NEWBIE}`))
      .send({ role: 'owner' })
      .expect(200);
    await as(OWNER, api().patch(`${base}/${NEWBIE}`))
      .send({ role: 'admin' })
      .expect(200);
    await as(OWNER, api().patch(`${base}/${NEWBIE}`))
      .send({ role: 'owner' })
      .expect(200);
    // With two owners, one may step down.
    await as(OWNER, api().patch(`${base}/${OWNER}`))
      .send({ role: 'admin' })
      .expect(200);
    expect(await memberRole(TEST_TENANT_ID, OWNER)).toBe('admin');
    // The remaining owner is now protected.
    await as(NEWBIE, api().patch(`${base}/${NEWBIE}`))
      .send({ role: 'member' })
      .expect(409);
    // Restore the original owner.
    await as(NEWBIE, api().patch(`${base}/${OWNER}`))
      .send({ role: 'owner' })
      .expect(200);
    await as(OWNER, api().delete(`${base}/${NEWBIE}`)).expect(200, { ok: true });
    expect(await memberRole(TEST_TENANT_ID, NEWBIE)).toBeUndefined();
  });

  it('removes a member and ends their access at once', async () => {
    await ds.query(
      `INSERT INTO organization_members (tenant_id, user_id, role) VALUES ($1, $2, 'member')`,
      [TEST_TENANT_ID, NEWBIE],
    );
    await as(MEMBER, api().delete(`${base}/${NEWBIE}`)).expect(403);
    await as(ADMIN, api().delete(`${base}/${NEWBIE}`)).expect(200, { ok: true });
    await as(NEWBIE, api().get('/api/v1/agents'), TEST_TENANT_ID).expect(403);
    await as(ADMIN, api().delete(`${base}/${NEWBIE}`)).expect(404); // already gone
  });

  it('is scoped to the organization in the path: a member of another tenant is not found here', async () => {
    // OUTSIDER belongs to ORG_B only; asking TEST_TENANT_ID to drop or change it is a 404.
    await as(OWNER, api().delete(`${base}/${OUTSIDER}`)).expect(404);
    await as(OWNER, api().patch(`${base}/${OUTSIDER}`))
      .send({ role: 'viewer' })
      .expect(404);
    expect(await memberRole(ORG_B, OUTSIDER)).toBe('owner');
  });

  it("cannot manage another organization's members without belonging to it", async () => {
    const other = `/api/v1/organizations/${ORG_B}/members`;
    for (const call of [
      as(OWNER, api().post(other)).send({ email: `${MEMBER}@test.local`, role: 'viewer' }),
      as(OWNER, api().patch(`${other}/${OUTSIDER}`)).send({ role: 'viewer' }),
      as(OWNER, api().delete(`${other}/${OUTSIDER}`)),
    ]) {
      const res = await call.expect(403);
      expect(res.body.code).toBe('not_a_member');
    }
    expect(await memberRole(ORG_B, OUTSIDER)).toBe('owner');
  });
});

describe('admin users (instance administrator)', () => {
  it('is closed to organization owners and admins', async () => {
    for (const user of [OWNER, ADMIN]) {
      const res = await as(user, api().get('/api/v1/admin/users')).expect(403);
      expect(res.body.code).toBe('insufficient_role');
    }
    await as(OWNER, api().post('/api/v1/admin/users'))
      .send({ email: 'x@y.test', name: 'X' })
      .expect(403);
    await as(OWNER, api().post(`/api/v1/admin/users/${MEMBER}/reset-password`)).expect(403);
    await as(OWNER, api().patch(`/api/v1/admin/users/${MEMBER}`))
      .send({ isInstanceAdmin: true })
      .expect(403);
  });

  it('lists accounts with their active organizations', async () => {
    const res = await as(ROOT, api().get('/api/v1/admin/users')).expect(200);
    const outsider = res.body.users.find((u: { id: string }) => u.id === OUTSIDER);
    expect(outsider.organizations).toEqual([{ id: ORG_B, name: 'Org B', role: 'owner' }]);
    expect(outsider.isInstanceAdmin).toBe(false);
    const root = res.body.users.find((u: { id: string }) => u.id === ROOT);
    expect(root.isInstanceAdmin).toBe(true);
    // Deactivated organizations drop out of the membership lists.
    const gone = res.body.users.flatMap((u: { organizations: Array<{ name: string }> }) =>
      u.organizations.filter((o) => o.name === 'Gone'),
    );
    expect(gone).toEqual([]);
  });

  it('is 404 for an unknown account on reset and update', async () => {
    await as(ROOT, api().post(`/api/v1/admin/users/${randomUUID()}/reset-password`)).expect(404);
    await as(ROOT, api().patch(`/api/v1/admin/users/${randomUUID()}`))
      .send({ isInstanceAdmin: true })
      .expect(404);
  });

  it('never leaves the instance without an administrator', async () => {
    const demote = await as(ROOT, api().patch(`/api/v1/admin/users/${ROOT}`))
      .send({ isInstanceAdmin: false })
      .expect(409);
    expect(demote.body.message).toMatch(/at least one administrator/);

    const promoted = await as(ROOT, api().patch(`/api/v1/admin/users/${MEMBER}`))
      .send({ isInstanceAdmin: true })
      .expect(200);
    expect(promoted.body.user).toMatchObject({ id: MEMBER, isInstanceAdmin: true });
    // With a second administrator, either may step down; the last one may not.
    await as(MEMBER, api().patch(`/api/v1/admin/users/${ROOT}`))
      .send({ isInstanceAdmin: false })
      .expect(200);
    await as(MEMBER, api().patch(`/api/v1/admin/users/${MEMBER}`))
      .send({ isInstanceAdmin: false })
      .expect(409);
    // Restore.
    await as(MEMBER, api().patch(`/api/v1/admin/users/${ROOT}`))
      .send({ isInstanceAdmin: true })
      .expect(200);
    await as(ROOT, api().patch(`/api/v1/admin/users/${MEMBER}`))
      .send({ isInstanceAdmin: false })
      .expect(200);
  });
});

describe('console: search, alerts and canvas', () => {
  const search = (userId: string, q: string, orgId?: string) =>
    as(userId, api().get('/api/v1/search').query({ q }), orgId).expect(200);
  const types = (res: request.Response) => res.body.results.map((r: { type: string }) => r.type);

  beforeAll(async () => {
    await as(OWNER, api().post('/api/v1/agents')).send({ name: 'oabs-search-bot' }).expect(201);
    await as(OUTSIDER, api().post('/api/v1/agents'))
      .send({ name: 'oabs-search-bot-b' })
      .expect(201);
  });

  it('needs at least two characters after trimming', async () => {
    for (const q of ['', ' ', 'o', ' o ', '  ']) {
      expect((await search(OWNER, q)).body.results).toEqual([]);
    }
    const two = await search(OWNER, 'oa');
    expect(types(two)).toContain('harness');
  });

  it('answers 200 with no results when q is missing', async () => {
    const res = await as(OWNER, api().get('/api/v1/search')).expect(200);
    expect(res.body.results).toEqual([]);
  });

  it('only returns harnesses of the active organization', async () => {
    const mine = await search(OWNER, 'oabs-search');
    const titles = mine.body.results.map((r: { title: string }) => r.title);
    expect(titles).toContain('oabs-search-bot');
    expect(titles).not.toContain('oabs-search-bot-b');
    const theirs = await search(OUTSIDER, 'oabs-search');
    const theirTitles = theirs.body.results.map((r: { title: string }) => r.title);
    expect(theirTitles).toEqual(['oabs-search-bot-b']);
  });

  it('finds members by email inside the organization only', async () => {
    const res = await search(MEMBER, 'oabs-adm');
    expect(res.body.results).toEqual([
      expect.objectContaining({
        type: 'member',
        id: ADMIN,
        subtitle: `${ADMIN}@test.local · admin`,
        href: '/organization',
      }),
    ]);
    // ORG_B cannot see TEST_TENANT's members.
    expect((await search(OUTSIDER, 'oabs-adm')).body.results).toEqual([]);
  });

  it('treats LIKE wildcards literally', async () => {
    for (const q of ['%%', '__', 'o_', '%a%']) {
      expect((await search(OWNER, q)).body.results).toEqual([]);
    }
  });

  it('refuses to search another organization by header without belonging to it', async () => {
    await as(VIEWER, api().get('/api/v1/search').query({ q: 'oabs' }), ORG_B).expect(403);
  });

  describe('alerts', () => {
    const insertRequest = (
      tenant: string,
      status: string,
      ageMinutes: number,
      message = 'boom',
    ) => {
      const id = randomUUID();
      return ds
        .query(
          `INSERT INTO requests (id, tenant_id, agent_name, timestamp, status, error_message, error_http_status)
           VALUES ($1, $2, 'oabs-alert-bot', ${minutesAgo(ageMinutes)}, $3, $4, 500)`,
          [id, tenant, status, message],
        )
        .then(() => id);
    };

    it('covers the failure statuses within 24 hours, newest first, and nothing else', async () => {
      const within = await insertRequest(TEST_TENANT_ID, 'rate_limited', 23 * 60);
      const fresh = await insertRequest(TEST_TENANT_ID, 'fallback_error', 1);
      const failed = await insertRequest(TEST_TENANT_ID, 'failed', 5);
      const stale = await insertRequest(TEST_TENANT_ID, 'error', 25 * 60);
      const pending = await insertRequest(TEST_TENANT_ID, 'pending', 1);
      const cancelled = await insertRequest(TEST_TENANT_ID, 'cancelled', 1);
      const ok = await insertRequest(TEST_TENANT_ID, 'ok', 1);
      const foreign = await insertRequest(ORG_B, 'error', 1);

      const res = await as(VIEWER, api().get('/api/v1/alerts')).expect(200);
      const ids: string[] = res.body.items.map((i: { id: string }) => i.id);
      expect(ids).toEqual(expect.arrayContaining([within, fresh, failed]));
      for (const excluded of [stale, pending, cancelled, ok, foreign]) {
        expect(ids).not.toContain(excluded);
      }
      // Newest first.
      const order = [fresh, failed, within].map((id) => ids.indexOf(id));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('lists at most 30 items while the total counts the whole window', async () => {
      const bulk = Array.from({ length: 35 }, () => randomUUID());
      await ds.query(
        `INSERT INTO requests (id, tenant_id, agent_name, timestamp, status, error_message)
         SELECT x, $1, 'oabs-bulk', now() - interval '2 minutes', 'error', 'bulk'
           FROM unnest($2::varchar[]) AS x`,
        [ORG_B, bulk],
      );
      const res = await as(OUTSIDER, api().get('/api/v1/alerts')).expect(200);
      expect(res.body.items).toHaveLength(30);
      expect(res.body.total).toBeGreaterThanOrEqual(36);
      // The other organization's total is untouched by this flood.
      const mine = await as(OWNER, api().get('/api/v1/alerts')).expect(200);
      expect(mine.body.total).toBeLessThan(35);
    });

    it('truncates long error messages to 300 characters', async () => {
      const id = await insertRequest(TEST_TENANT_ID, 'error', 1, 'x'.repeat(1000));
      const res = await as(OWNER, api().get('/api/v1/alerts')).expect(200);
      const item = res.body.items.find((i: { id: string }) => i.id === id);
      expect(item.errorMessage).toHaveLength(300);
    });
  });

  describe('canvas positions', () => {
    const positions = { positions: [{ id: 'oabs-node', x: 10.6, y: 20 }] };

    it('are written by members and above, never by viewers', async () => {
      const denied = await as(VIEWER, api().put('/api/v1/topology/positions'))
        .send(positions)
        .expect(403);
      expect(denied.body.code).toBe('insufficient_role');
      await as(VIEWER, api().delete('/api/v1/topology/positions')).expect(403);
      await as(MEMBER, api().put('/api/v1/topology/positions')).send(positions).expect(204);
      const canvas = await as(VIEWER, api().get('/api/v1/topology')).expect(200);
      expect(canvas.body.positions['oabs-node']).toEqual({ x: 11, y: 20 });
    });

    it('are isolated per organization', async () => {
      const other = await as(OUTSIDER, api().get('/api/v1/topology')).expect(200);
      expect(other.body.positions).toEqual({});
      await as(OUTSIDER, api().delete('/api/v1/topology/positions')).expect(204);
      const mine = await as(MEMBER, api().get('/api/v1/topology')).expect(200);
      expect(mine.body.positions['oabs-node']).toBeDefined();
      await as(MEMBER, api().delete('/api/v1/topology/positions')).expect(204);
      expect((await as(MEMBER, api().get('/api/v1/topology')).expect(200)).body.positions).toEqual(
        {},
      );
    });

    it('falls back to 24h for an unknown range and honors known ones', async () => {
      expect(
        (await as(OWNER, api().get('/api/v1/topology').query({ range: 'bogus' }))).body.range,
      ).toBe('24h');
      expect(
        (await as(OWNER, api().get('/api/v1/topology').query({ range: '30m' }))).body.range,
      ).toBe('30m');
      expect(
        (await as(OWNER, api().get('/api/v1/topology').query({ range: 'live' }))).body.range,
      ).toBe('live');
    });
  });
});

describe('sessions', () => {
  const S_MAIN = 'oabs-sess-main';
  const S_SUB = 'oabs-sess-sub';
  const S_OTHER = 'oabs-sess-other';
  const S_B_ONLY = 'oabs-sess-b-only';
  const B_AGENT_ID = 'oabs-b-agent';

  const insertRequest = (r: {
    id: string;
    tenant: string;
    agentId?: string | null;
    agentName?: string | null;
    session: string | null;
    parent?: string | null;
    ageMinutes: number;
    durationMs?: number | null;
    status: string;
    headers?: object;
  }) =>
    ds.query(
      `INSERT INTO requests
         (id, tenant_id, agent_id, agent_name, session_id, parent_session_id, timestamp, duration_ms,
          status, request_headers)
       VALUES ($1, $2, $3, $4, $5, $6, ${minutesAgo(r.ageMinutes)}, $7, $8, $9)`,
      [
        r.id,
        r.tenant,
        r.agentId ?? null,
        r.agentName ?? null,
        r.session,
        r.parent ?? null,
        r.durationMs ?? null,
        r.status,
        r.headers ? JSON.stringify(r.headers) : null,
      ],
    );

  const insertAttempt = (a: {
    requestId: string;
    tenant: string;
    agentId?: string | null;
    status?: string;
    provider: string;
    model: string;
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
    cost: number | null;
  }) =>
    ds.query(
      `INSERT INTO agent_messages
         (id, request_id, tenant_id, agent_id, timestamp, status, provider, model, input_tokens,
          output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(),
        a.requestId,
        a.tenant,
        a.agentId ?? null,
        a.status ?? 'ok',
        a.provider,
        a.model,
        a.input,
        a.output,
        a.cacheRead ?? 0,
        a.cacheCreation ?? 0,
        a.cost,
      ],
    );

  const list = (userId: string, query: Record<string, string> = {}, orgId?: string) =>
    as(userId, api().get('/api/v1/sessions').query(query), orgId);
  const one = (userId: string, id: string, orgId?: string) =>
    as(userId, api().get(`/api/v1/sessions/${id}`), orgId);

  beforeAll(async () => {
    const A = { tenant: TEST_TENANT_ID, agentId: TEST_AGENT_ID, agentName: 'test-agent' };
    const r = Object.fromEntries(
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'rb1', 'rb2'].map((k) => [k, randomUUID()]),
    );

    // Main session of tenant A: 3 requests of its own (ok, failed, in flight) + 1 subagent request.
    await insertRequest({
      ...A,
      id: r.r1,
      session: S_MAIN,
      ageMinutes: 10,
      durationMs: 2000,
      status: 'ok',
      headers: {
        'user-agent': 'opencode/1.0 old',
        'x-opencode-project': 'proj-a',
        'x-opencode-client': 'cli',
      },
    });
    await insertRequest({
      ...A,
      id: r.r2,
      session: S_MAIN,
      ageMinutes: 8,
      durationMs: 1000,
      status: 'error',
      headers: {
        'user-agent': 'opencode/2.0 latest',
        'x-opencode-project': 'proj-b',
        'x-opencode-client': 'desktop',
      },
    });
    await insertRequest({ ...A, id: r.r3, session: S_MAIN, ageMinutes: 1, status: 'pending' });
    await insertRequest({
      ...A,
      id: r.r4,
      session: S_SUB,
      parent: S_MAIN,
      ageMinutes: 9,
      durationMs: 500,
      status: 'ok',
    });
    // A second, older session (10 hours: clear of the 1h range even when the runner's TZ shifts
    // the JS-computed cutoff by a few hours), and requests with no session at all.
    await insertRequest({
      ...A,
      id: r.r5,
      session: S_OTHER,
      ageMinutes: 600,
      durationMs: 100,
      status: 'ok',
    });
    await insertRequest({ ...A, id: r.r6, session: null, ageMinutes: 2, status: 'ok' });

    // Attempts of tenant A (cost -1 is a failed pricing lookup and must not count).
    await insertAttempt({
      ...A,
      requestId: r.r1,
      provider: 'openai',
      model: 'gpt-4o',
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheCreation: 5,
      cost: 0.1,
    });
    await insertAttempt({
      ...A,
      requestId: r.r1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      input: 1,
      output: 1,
      cost: -1,
    });
    await insertAttempt({
      ...A,
      requestId: r.r2,
      status: 'error',
      provider: 'groq',
      model: 'llama-x',
      input: 20,
      output: 0,
      cost: 0.02,
    });
    await insertAttempt({
      ...A,
      requestId: r.r4,
      provider: 'anthropic',
      model: 'claude-haiku',
      input: 40,
      output: 20,
      cost: 0.03,
    });
    await insertAttempt({
      ...A,
      requestId: r.r5,
      provider: 'openai',
      model: 'gpt-4o',
      input: 1000,
      output: 1000,
      cost: 5,
    });

    // Tenant B: a session with the SAME id as A's main one, plus its own agent and session.
    await ds.query(
      `INSERT INTO agents (id, name, display_name, description, is_active, complexity_routing_enabled, tenant_id, created_at, updated_at)
       VALUES ($1, 'b-agent', 'B Agent', 'b', true, true, $2, now(), now())`,
      [B_AGENT_ID, ORG_B],
    );
    const B = { tenant: ORG_B, agentId: B_AGENT_ID, agentName: 'b-agent' };
    await insertRequest({
      ...B,
      id: r.rb1,
      session: S_MAIN,
      ageMinutes: 1,
      durationMs: 100,
      status: 'ok',
      headers: { 'user-agent': 'tenant-b-secret' },
    });
    await insertRequest({
      ...B,
      id: r.rb2,
      session: S_B_ONLY,
      ageMinutes: 2,
      durationMs: 100,
      status: 'ok',
    });
    await insertAttempt({
      ...B,
      requestId: r.rb1,
      provider: 'openai',
      model: 'b-model',
      input: 7000,
      output: 7000,
      cost: 99,
    });
    await insertAttempt({
      ...B,
      requestId: r.rb2,
      provider: 'openai',
      model: 'b-model',
      input: 1,
      output: 1,
      cost: 1,
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('aggregates a main session together with its subagent sessions', async () => {
      const res = await list(VIEWER).expect(200);
      const main = res.body.items.find((s: { id: string }) => s.id === S_MAIN);
      expect(main).toMatchObject({
        id: S_MAIN,
        agent_id: TEST_AGENT_ID,
        agent_name: 'test-agent',
        requests: 4, // r1, r2, r3 and the subagent's r4
        failed: 1, // r2
        in_flight: 1, // r3 is pending
        subagents: 1,
        input_tokens: 161, // 100 + 1 + 20 + 40
        output_tokens: 71, // 50 + 1 + 0 + 20
        cache_read_tokens: 10,
        cache_creation_tokens: 5,
        // The -1 cost is a failed lookup: 0.10 + 0.02 + 0.03
        cost: expect.closeTo(0.15, 6),
      });
      // Only successful attempts name models and providers.
      expect(main.models).toEqual(['claude-haiku', 'gpt-4o', 'gpt-4o-mini']);
      expect(main.providers).toEqual(['anthropic', 'openai']);
      expect(new Date(main.last_at).getTime()).toBeGreaterThan(new Date(main.started_at).getTime());
    });

    it('lists the tenant sessions latest first and leaves out requests without a session', async () => {
      const res = await list(VIEWER).expect(200);
      expect(res.body.items.map((s: { id: string }) => s.id)).toEqual([S_MAIN, S_OTHER]);
      // The subagent session is not a session of its own.
      expect(res.body.items.map((s: { id: string }) => s.id)).not.toContain(S_SUB);
      expect(res.body.has_more).toBe(false);
    });

    it('keeps another tenant out, even for the same session id', async () => {
      const mine = await list(OWNER).expect(200);
      const main = mine.body.items.find((s: { id: string }) => s.id === S_MAIN);
      expect(main.cost).toBeLessThan(1); // not 99 from tenant B
      expect(main.input_tokens).toBe(161);
      expect(JSON.stringify(mine.body)).not.toContain('b-model');
      expect(JSON.stringify(mine.body)).not.toContain(S_B_ONLY);

      const theirs = await list(OUTSIDER).expect(200);
      expect(theirs.body.items.map((s: { id: string }) => s.id).sort()).toEqual(
        [S_MAIN, S_B_ONLY].sort(),
      );
      const theirMain = theirs.body.items.find((s: { id: string }) => s.id === S_MAIN);
      expect(theirMain).toMatchObject({
        requests: 1,
        cost: 99,
        input_tokens: 7000,
        agent_name: 'b-agent',
      });
    });

    it('filters by range', async () => {
      const hour = await list(VIEWER, { range: '1h' }).expect(200);
      expect(hour.body.items.map((s: { id: string }) => s.id)).toEqual([S_MAIN]);
      const day = await list(VIEWER, { range: '24h' }).expect(200);
      expect(day.body.items.map((s: { id: string }) => s.id)).toEqual([S_MAIN, S_OTHER]);
    });

    it('filters by harness name within the tenant only', async () => {
      const ok = await list(VIEWER, { agent_name: 'test-agent' }).expect(200);
      expect(ok.body.items).toHaveLength(2);
      expect((await list(VIEWER, { agent_name: 'no-such-agent' }).expect(200)).body.items).toEqual(
        [],
      );
      // A harness name that exists only in another organization matches nothing here.
      expect((await list(VIEWER, { agent_name: 'b-agent' }).expect(200)).body.items).toEqual([]);
    });

    it('pages with limit and offset', async () => {
      const first = await list(VIEWER, { limit: '1' }).expect(200);
      expect(first.body.items.map((s: { id: string }) => s.id)).toEqual([S_MAIN]);
      expect(first.body.has_more).toBe(true);
      const second = await list(VIEWER, { limit: '1', offset: '1' }).expect(200);
      expect(second.body.items.map((s: { id: string }) => s.id)).toEqual([S_OTHER]);
      expect(second.body.has_more).toBe(false);
      const beyond = await list(VIEWER, { limit: '1', offset: '5' }).expect(200);
      expect(beyond.body).toEqual({ items: [], has_more: false });
    });

    it('clamps limit=0 to one item', async () => {
      const res = await list(VIEWER, { limit: '0' }).expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it.each<Record<string, string>>([
      { limit: '1000' },
      { limit: 'abc' },
      { limit: '-1' },
      { offset: '9999999' },
      { offset: 'x' },
      { tenant_id: ORG_B },
    ])('rejects the malformed query %p with 400', async (query) => {
      await list(VIEWER, query).expect(400);
    });

    it('cannot be pointed at another organization by header without belonging to it', async () => {
      await list(VIEWER, {}, ORG_B).expect(403);
    });

    it('is empty for a user with no organization', async () => {
      const lonely = 'oabs-lonely';
      await ds.query(`INSERT INTO "user" (id, email, name) VALUES ($1, $2, $1)`, [
        lonely,
        `${lonely}@test.local`,
      ]);
      const res = await list(lonely).expect(200);
      expect(res.body).toEqual({ items: [], has_more: false });
      await one(lonely, S_MAIN).expect(404);
    });

    it('lets the instance administrator read any active organization', async () => {
      const res = await list(ROOT, {}, ORG_B).expect(200);
      expect(res.body.items.map((s: { id: string }) => s.id).sort()).toEqual(
        [S_MAIN, S_B_ONLY].sort(),
      );
    });
  });

  describe('GET /api/v1/sessions/:id', () => {
    it('breaks a session down per subagent session', async () => {
      const res = await one(OWNER, S_MAIN).expect(200);
      expect(res.body).toMatchObject({
        id: S_MAIN,
        requests: 4,
        failed: 1,
        in_flight: 1,
        subagents: 1,
        parent_session_id: null,
        input_tokens: 161,
      });
      const parts = Object.fromEntries(
        res.body.parts.map((p: { session_id: string }) => [p.session_id, p]),
      );
      expect(Object.keys(parts).sort()).toEqual([S_MAIN, S_SUB].sort());
      expect(parts[S_MAIN]).toMatchObject({
        is_main: true,
        requests: 3,
        failed: 1,
        input_tokens: 121,
      });
      expect(parts[S_SUB]).toMatchObject({
        is_main: false,
        requests: 1,
        failed: 0,
        input_tokens: 40,
        output_tokens: 20,
      });
      expect(parts[S_SUB].cost).toBeCloseTo(0.03, 6);
      // The parts add up to the whole.
      const total = res.body.parts.reduce(
        (n: number, p: { requests: number }) => n + p.requests,
        0,
      );
      expect(total).toBe(res.body.requests);
    });

    it('opened on a subagent session, points back to its main session', async () => {
      const res = await one(OWNER, S_SUB).expect(200);
      expect(res.body).toMatchObject({ id: S_SUB, parent_session_id: S_MAIN, requests: 1 });
    });

    it('shows the client (latest recorded headers) to owners and admins only', async () => {
      for (const user of [OWNER, ADMIN]) {
        const res = await one(user, S_MAIN).expect(200);
        expect(res.body.client).toEqual({
          user_agent: 'opencode/2.0 latest',
          project: 'proj-b',
          client: 'desktop',
        });
      }
      for (const user of [MEMBER, VIEWER]) {
        const res = await one(user, S_MAIN).expect(200);
        expect(res.body.client).toBeNull();
        expect(JSON.stringify(res.body)).not.toContain('opencode/');
      }
      // The instance administrator acts as owner in any organization.
      const root = await one(ROOT, S_MAIN, TEST_TENANT_ID).expect(200);
      expect(root.body.client).toMatchObject({ user_agent: 'opencode/2.0 latest' });
    });

    it('has no client for a session whose requests recorded no headers', async () => {
      const res = await one(OWNER, S_OTHER).expect(200);
      expect(res.body.client).toBeNull();
    });

    it('is 404 for an unknown session', async () => {
      await one(OWNER, 'oabs-no-such-session').expect(404);
    });

    it("is 404 for another tenant's session and never leaks its data", async () => {
      await one(OWNER, S_B_ONLY).expect(404);
      await one(OUTSIDER, S_OTHER).expect(404);
      const theirMain = await one(OUTSIDER, S_MAIN).expect(200);
      expect(theirMain.body).toMatchObject({ requests: 1, cost: 99 });
      expect(theirMain.body.client).toEqual({
        user_agent: 'tenant-b-secret',
        project: null,
        client: null,
      });
      const mine = await one(OWNER, S_MAIN).expect(200);
      expect(JSON.stringify(mine.body)).not.toContain('tenant-b-secret');
    });

    it('does not treat LIKE or path tricks as ids', async () => {
      await one(OWNER, '%25').expect(404);
      await one(OWNER, '..%2F..%2Fmembers').expect(404);
    });
  });
});
