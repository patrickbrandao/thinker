import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NotFoundException } from '@nestjs/common';
import type { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { SessionsController, SessionsQueryDto } from './sessions.controller';

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: 'org-1',
  userId: 'u',
  role: 'viewer',
  isInstanceAdmin: false,
  ...over,
});

function build() {
  const sessions = {
    list: jest.fn().mockResolvedValue({ items: [], has_more: false }),
    get: jest.fn().mockResolvedValue({ id: 's1' }),
    timeline: jest.fn().mockResolvedValue({ points: [] }),
  };
  return { controller: new SessionsController(sessions as never), sessions };
}

const query = (over: Partial<SessionsQueryDto> = {}) => Object.assign(new SessionsQueryDto(), over);

describe('SessionsController.list', () => {
  it('returns an empty page for a user with no organization', () => {
    const { controller, sessions } = build();
    expect(controller.list(query(), ctx({ tenantId: null }))).toEqual({
      items: [],
      has_more: false,
    });
    expect(sessions.list).not.toHaveBeenCalled();
  });

  it('defaults to 50 sessions from offset 0 in the active organization', () => {
    const { controller, sessions } = build();
    controller.list(query(), ctx());
    expect(sessions.list).toHaveBeenCalledWith({
      tenantId: 'org-1',
      range: undefined,
      agentName: undefined,
      hasErrors: false,
      hasSubagents: false,
      limit: 50,
      offset: 0,
    });
  });

  it('passes the has_errors and has_subagents filters through', () => {
    const { controller, sessions } = build();
    controller.list(query({ has_errors: 'true', has_subagents: 'true' }), ctx());
    expect(sessions.list).toHaveBeenCalledWith(
      expect.objectContaining({ hasErrors: true, hasSubagents: true }),
    );
    expect(
      validateSync(plainToInstance(SessionsQueryDto, { has_errors: 'yes' })).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['0', 1],
    ['1', 1],
    ['200', 200],
    ['999', 200],
    ['75', 75],
  ])('clamps limit %s to %i', (limit, expected) => {
    const { controller, sessions } = build();
    controller.list(query({ limit }), ctx());
    expect(sessions.list.mock.calls[0][0].limit).toBe(expected);
  });

  it('forwards range, agent name and offset, treating an empty agent as no filter', () => {
    const { controller, sessions } = build();
    controller.list(query({ range: '7d', agent_name: 'bot', offset: '100' }), ctx());
    expect(sessions.list).toHaveBeenCalledWith({
      tenantId: 'org-1',
      range: '7d',
      agentName: 'bot',
      hasErrors: false,
      hasSubagents: false,
      limit: 50,
      offset: 100,
    });
    controller.list(query({ agent_name: '' }), ctx());
    expect(sessions.list.mock.calls[1][0].agentName).toBeUndefined();
  });

  it('takes the organization from the context, never from the query', () => {
    const { controller, sessions } = build();
    controller.list(
      Object.assign(query(), { tenantId: 'other-org', tenant_id: 'other-org' }),
      ctx(),
    );
    expect(sessions.list.mock.calls[0][0].tenantId).toBe('org-1');
  });
});

describe('SessionsQueryDto', () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(SessionsQueryDto, plain)).map((e) => e.property);

  it('accepts a well-formed query', () => {
    expect(errors({ range: '24h', agent_name: 'bot', limit: '50', offset: '0' })).toEqual([]);
  });

  it.each([
    ['limit', '1000'],
    ['limit', '-1'],
    ['limit', 'ten'],
    ['limit', '1.5'],
    ['offset', '1234567'],
    ['offset', '-5'],
    ['offset', 'x'],
  ])('rejects %s=%s', (property, value) => {
    expect(errors({ [property]: value })).toEqual([property]);
  });
});

describe('SessionsController.get', () => {
  it('is 404 without an organization', async () => {
    const { controller, sessions } = build();
    await expect(controller.get('s1', ctx({ tenantId: null }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sessions.get).not.toHaveBeenCalled();
  });

  it('is 404 when the session is not in the organization', async () => {
    const { controller, sessions } = build();
    sessions.get.mockResolvedValue(null);
    await expect(controller.get('foreign', ctx())).rejects.toBeInstanceOf(NotFoundException);
    expect(sessions.get).toHaveBeenCalledWith('org-1', 'foreign', false);
  });

  it.each([
    ['viewer', false, false],
    ['member', false, false],
    ['admin', false, true],
    ['owner', false, true],
    [null, false, false],
    // The instance admin acts as owner anywhere.
    ['viewer', true, true],
    // An internal context (no role at all) is not a user credential.
    [undefined, false, true],
  ] as const)('role %p (instance admin %p) sees the client: %p', async (role, admin, expected) => {
    const { controller, sessions } = build();
    await controller.get('s1', ctx({ role: role as never, isInstanceAdmin: admin }));
    expect(sessions.get).toHaveBeenCalledWith('org-1', 's1', expected);
  });

  it('returns the session', async () => {
    const { controller } = build();
    await expect(controller.get('s1', ctx())).resolves.toEqual({ id: 's1' });
  });
});

describe('SessionsController.timeline', () => {
  it('forwards the same filters as the list', () => {
    const { controller, sessions } = build();
    controller.timeline(
      query({ range: '30d', agent_name: 'bot', has_errors: 'true', has_subagents: 'false' }),
      ctx(),
    );
    expect(sessions.timeline).toHaveBeenCalledWith({
      tenantId: 'org-1',
      range: '30d',
      agentName: 'bot',
      hasErrors: true,
      hasSubagents: false,
    });
  });

  it('is empty without an organization', () => {
    const { controller, sessions } = build();
    expect(controller.timeline(query(), ctx({ tenantId: null }))).toMatchObject({ points: [] });
    expect(sessions.timeline).not.toHaveBeenCalled();
  });
});
