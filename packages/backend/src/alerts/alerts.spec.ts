import type { DataSource } from 'typeorm';
import { visibilityWhere, workspaceCategories } from './alerts.service';
import { auditFields, nameFrom } from './audit.interceptor';
import { modelChangeAlerts, MAX_MODEL_CHANGE_ALERTS } from '../model-discovery/model-change-alerts';
import { isModelUnavailable } from '../triggers/trigger-listener.service';
import { recordAuthAlert, type AuthHookContext } from '../auth/auth-alerts';
import { setUserAlertSink, type UserRef } from '../common/services/alert-sink';
import {
  SystemEventsService,
  alertsRetentionDays,
  type SystemEventInput,
} from '../common/services/system-events.service';
import type { TriggerSignalService } from '../common/services/trigger-signal.service';

describe('alert visibility', () => {
  it('shows operational categories to members and adds audit and auth for admins', () => {
    expect(workspaceCategories({ role: 'member' })).toEqual([
      'models',
      'credentials',
      'limits',
      'triggers',
    ]);
    expect(workspaceCategories({ role: 'viewer' })).not.toContain('audit');
    expect(workspaceCategories({ role: 'admin' })).toEqual(
      expect.arrayContaining(['audit', 'auth']),
    );
    expect(workspaceCategories({ role: 'owner' })).toEqual(
      expect.arrayContaining(['audit', 'auth']),
    );
  });

  it('adds instance events only for instance administrators', () => {
    const params: unknown[] = [];
    const member = visibilityWhere({ tenantId: 't1', role: 'member' }, params);
    expect(member).not.toContain('IS NULL');
    expect(params).toEqual(['t1', ['models', 'credentials', 'limits', 'triggers']]);

    const adminParams: unknown[] = [];
    const admin = visibilityWhere(
      { tenantId: 't1', role: 'owner', isInstanceAdmin: true },
      adminParams,
    );
    expect(admin).toContain('e.tenant_id IS NULL');
    expect(adminParams[2]).toEqual(['catalog', 'auth']);

    expect(visibilityWhere({ tenantId: null, role: null }, [])).toBe('false');
  });
});

describe('modelChangeAlerts', () => {
  const conn = { id: 'c1', tenant_id: 't1', provider: 'openai', label: 'Default' };
  const models = (...ids: string[]) => ids.map((id) => ({ id }));

  it('summarizes the first discovery in one alert', () => {
    const out = modelChangeAlerts(conn, [], models('a', 'b', 'c'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'model.added',
      title: '3 models detected on openai "Default"',
    });
    expect(out[0]!.metadata).toMatchObject({ first_discovery: true, count: 3 });
  });

  it('reports each added and removed model afterwards', () => {
    const out = modelChangeAlerts(conn, models('a', 'b'), models('b', 'c'));
    expect(out.map((e) => [e.type, e.entityId])).toEqual([
      ['model.added', 'c'],
      ['model.removed', 'a'],
    ]);
    expect(out[1]!.level).toBe('warning');
  });

  it('says nothing for an empty list and collapses large changes', () => {
    expect(modelChangeAlerts(conn, models('a'), [])).toEqual([]);
    const many = Array.from({ length: MAX_MODEL_CHANGE_ALERTS + 1 }, (_, i) => `m${i}`);
    const out = modelChangeAlerts(conn, models('a'), models('a', ...many));
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe(`${many.length} models added to openai "Default"`);
  });
});

describe('isModelUnavailable', () => {
  it('recognizes model-not-found answers', () => {
    expect(isModelUnavailable(404, 'The model `gpt-9` does not exist', 'gpt-9')).toBe(true);
    expect(isModelUnavailable(400, '{"error":{"code":"model_not_found"}}', 'x')).toBe(true);
    expect(
      isModelUnavailable(400, 'Invalid model name passed in model=foo-1', 'openai/foo-1'),
    ).toBe(true);
  });

  it('ignores ordinary failures', () => {
    expect(isModelUnavailable(500, 'Internal server error', 'gpt-4o')).toBe(false);
    expect(isModelUnavailable(429, 'Rate limit reached for model gpt-4o', 'gpt-4o')).toBe(false);
    expect(isModelUnavailable(400, 'max_tokens is too large', 'gpt-4o')).toBe(false);
  });
});

describe('audit helpers', () => {
  it('keeps only the top-level field names, never values', () => {
    expect(auditFields({ name: 'x', secrets: { apiKey: 'sk-secret' } })).toEqual([
      'name',
      'secrets',
    ]);
    expect(auditFields(['a'])).toEqual([]);
    expect(auditFields(null)).toEqual([]);
  });

  it('finds a display name in a result', () => {
    expect(nameFrom({ display_name: 'Bot', name: 'bot' })).toBe('Bot');
    expect(nameFrom({ trigger: { name: 'Hook' } })).toBe('Hook');
    expect(nameFrom({ ok: true })).toBeNull();
  });
});

describe('auth alerts', () => {
  const seen: Array<{ user: UserRef; input: Omit<SystemEventInput, 'tenantId'> }> = [];
  beforeAll(() => setUserAlertSink((user, input) => seen.push({ user, input })));
  afterAll(() => setUserAlertSink(null));
  beforeEach(() => (seen.length = 0));

  const ctx = (over: Partial<AuthHookContext>): AuthHookContext => ({
    path: '/sign-in/email',
    headers: new Headers({ 'x-thinker-client-ip': '203.0.113.7', 'user-agent': 'UA' }),
    context: {},
    ...over,
  });

  it('records a sign-in with the address', () => {
    recordAuthAlert(ctx({ context: { newSession: { user: { id: 'u1', email: 'a@x.io' } } } }));
    expect(seen[0]!.user).toEqual({ userId: 'u1' });
    expect(seen[0]!.input).toMatchObject({ type: 'user.login', actorIp: '203.0.113.7' });
  });

  it('groups failed sign-ins per e-mail and address', () => {
    recordAuthAlert(
      ctx({
        body: { email: 'A@X.io', password: 'nope' },
        context: { returned: { name: 'APIError', status: 'UNAUTHORIZED', statusCode: 401 } },
      }),
    );
    expect(seen[0]!.user).toEqual({ email: 'a@x.io' });
    expect(seen[0]!.input).toMatchObject({
      type: 'user.login_failed',
      aggregate: true,
      dedupeKey: 'user.login_failed:a@x.io:203.0.113.7',
    });
    expect(JSON.stringify(seen[0]!.input)).not.toContain('nope');
  });

  it('records password changes and sign-outs', () => {
    recordAuthAlert(
      ctx({
        path: '/change-password',
        context: { session: { user: { id: 'u1', email: 'a@x.io' } } },
      }),
    );
    recordAuthAlert(ctx({ path: '/sign-out' }), { id: 'u1', email: 'a@x.io' });
    expect(seen.map((s) => s.input.type)).toEqual(['user.password_changed', 'user.logout']);
  });
});

describe('SystemEventsService', () => {
  function service() {
    const query = jest.fn().mockResolvedValue([]);
    const emit = jest.fn();
    const svc = new SystemEventsService(
      { query } as unknown as DataSource,
      { emit } as unknown as TriggerSignalService,
    );
    return { svc, query, emit };
  }

  it('inserts, and hands workspace trigger events to the triggers module', async () => {
    const { svc, query, emit } = service();
    await svc.write({ tenantId: 't1', level: 'info', type: 'model.added', title: 'x' });
    expect(query.mock.calls[0][0]).toContain('INSERT INTO system_events');
    expect(query.mock.calls[0][1][3]).toBe('models');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'system', type: 'model.added' }),
    );
    await svc.write({ tenantId: 't1', level: 'error', type: 'limit.block', title: 'x' });
    await svc.write({ tenantId: null, level: 'warning', type: 'catalog.sync_failed', title: 'x' });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('drops repeats inside the window, or counts them when aggregating', async () => {
    const { svc, query } = service();
    const base = {
      tenantId: 't1',
      level: 'warning' as const,
      type: 'user.login_failed' as const,
      title: 'x',
      dedupeKey: 'k',
      dedupeWindowMs: 60_000,
    };
    expect(await svc.write(base)).toEqual(expect.any(String));
    expect(await svc.write(base)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    await svc.write({ ...base, dedupeKey: 'k2', aggregate: true });
    await svc.write({ ...base, dedupeKey: 'k2', aggregate: true });
    expect(query.mock.calls.at(-1)![0]).toContain("jsonb_set(metadata, '{count}'");
  });

  it('keeps alerts 90 days unless THINKER_ALERTS_RETENTION_DAYS says otherwise', () => {
    expect(alertsRetentionDays({})).toBe(90);
    expect(alertsRetentionDays({ THINKER_ALERTS_RETENTION_DAYS: '30' })).toBe(30);
    expect(alertsRetentionDays({ THINKER_ALERTS_RETENTION_DAYS: 'x' })).toBe(90);
  });
});
