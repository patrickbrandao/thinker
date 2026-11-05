import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { MIN_ROLE_KEY } from '../../../common/decorators/roles.decorator';
import type { TenantContext } from '../../../common/decorators/tenant-context.decorator';
import { OpencodeOauthController } from './opencode-oauth.controller';
import type { OpencodeOauthService } from './opencode-oauth.service';
import type { ResolveAgentService } from '../../routing-core/resolve-agent.service';
import type { ProviderService } from '../../routing-core/provider.service';
import type { ProviderKeyService } from '../../routing-core/provider-key.service';

describe('OpencodeOauthController', () => {
  let controller: OpencodeOauthController;
  let oauthService: {
    startAuthorization: jest.Mock;
    pollAuthorization: jest.Mock;
    readGoUsage: jest.Mock;
  };
  let resolveAgent: { resolve: jest.Mock };
  let providerService: { removeProvider: jest.Mock };
  let providerKeys: { getProviderApiKey: jest.Mock };

  const ctx = { tenantId: 'tenant-1', userId: 'user-1' } as TenantContext;
  const agent = { id: 'agent-1', tenant_id: 'tenant-1' };

  beforeEach(() => {
    oauthService = {
      startAuthorization: jest.fn(),
      pollAuthorization: jest.fn(),
      readGoUsage: jest.fn(),
    };
    resolveAgent = { resolve: jest.fn().mockResolvedValue(agent) };
    providerService = { removeProvider: jest.fn().mockResolvedValue({ notifications: ['n1'] }) };
    providerKeys = { getProviderApiKey: jest.fn() };
    controller = new OpencodeOauthController(
      oauthService as unknown as OpencodeOauthService,
      resolveAgent as unknown as ResolveAgentService,
      providerService as unknown as ProviderService,
      providerKeys as unknown as ProviderKeyService,
    );
  });

  describe('access control', () => {
    it('requires at least the admin role, reads included', () => {
      expect(Reflect.getMetadata(MIN_ROLE_KEY, OpencodeOauthController)).toEqual({
        role: 'admin',
        includeReads: true,
      });
    });
  });

  describe('GET usage', () => {
    it('rejects a missing agentName', async () => {
      await expect(controller.usage('', undefined, ctx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(resolveAgent.resolve).not.toHaveBeenCalled();
    });

    it('rejects a label sent more than once', async () => {
      await expect(controller.usage('a', ['x', 'y'], ctx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('resolves the agent inside the caller tenant and reads the stored OpenCode Go login', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue('stored-blob');
      const usage = { rolling: null, weekly: null, monthly: null };
      oauthService.readGoUsage.mockResolvedValue(usage);

      const result = await controller.usage('my-agent', '  work  ', ctx);

      expect(resolveAgent.resolve).toHaveBeenCalledWith('tenant-1', 'my-agent');
      expect(providerKeys.getProviderApiKey).toHaveBeenCalledWith(
        'tenant-1',
        'opencode-go',
        'subscription',
        'work',
        'agent-1',
      );
      expect(oauthService.readGoUsage).toHaveBeenCalledWith(
        'stored-blob',
        'agent-1',
        'tenant-1',
        'work',
      );
      expect(result).toEqual({ usage });
    });

    it('scopes by the resolved agent tenant, not by the user id', async () => {
      resolveAgent.resolve.mockResolvedValue({ id: 'agent-9', tenant_id: 'tenant-9' });
      providerKeys.getProviderApiKey.mockResolvedValue(null);
      await controller.usage('a', undefined, ctx);
      expect(providerKeys.getProviderApiKey.mock.calls[0][0]).toBe('tenant-9');
      expect(JSON.stringify(providerKeys.getProviderApiKey.mock.calls)).not.toContain('user-1');
    });

    it('returns a null usage when no login is stored, without calling the service', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue(null);
      await expect(controller.usage('a', undefined, ctx)).resolves.toEqual({ usage: null });
      expect(oauthService.readGoUsage).not.toHaveBeenCalled();
    });

    it('treats a blank label as no label', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue(null);
      await controller.usage('a', '   ', ctx);
      expect(providerKeys.getProviderApiKey.mock.calls[0][3]).toBeUndefined();
    });

    it('maps a usage failure to 503 with the error message', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue('blob');
      oauthService.readGoUsage.mockRejectedValue(new Error('OpenCode Go usage returned 500'));
      await expect(controller.usage('a', undefined, ctx)).rejects.toMatchObject({
        message: 'OpenCode Go usage returned 500',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });

    it('uses a generic message for a non-Error failure', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue('blob');
      oauthService.readGoUsage.mockRejectedValue('boom');
      await expect(controller.usage('a', undefined, ctx)).rejects.toMatchObject({
        message: 'Failed to read OpenCode Go usage',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });

    it('never puts the stored credential in the response', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue('SECRET-TOKEN-BLOB');
      oauthService.readGoUsage.mockResolvedValue({ rolling: null, weekly: null, monthly: null });
      const result = await controller.usage('a', undefined, ctx);
      expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN-BLOB');
    });

    it('does not leak the credential through an error', async () => {
      providerKeys.getProviderApiKey.mockResolvedValue('SECRET-TOKEN-BLOB');
      oauthService.readGoUsage.mockRejectedValue(new Error('upstream failed'));
      const err = await controller.usage('a', undefined, ctx).catch((e) => e);
      expect(JSON.stringify(err.getResponse())).not.toContain('SECRET-TOKEN-BLOB');
    });
  });

  describe('POST start', () => {
    it('rejects a missing agentName', async () => {
      await expect(controller.start('', undefined, ctx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('defaults to opencode-go and resolves the agent for provider connection', async () => {
      oauthService.startAuthorization.mockResolvedValue({ flowId: 'f1' });
      const result = await controller.start('my-agent', undefined, ctx);
      expect(resolveAgent.resolve).toHaveBeenCalledWith('tenant-1', 'my-agent', {
        allowPlayground: true,
      });
      expect(oauthService.startAuthorization).toHaveBeenCalledWith(
        'agent-1',
        'tenant-1',
        'user-1',
        'opencode-go',
      );
      expect(result).toEqual({ flowId: 'f1' });
    });

    it('accepts the opencode provider', async () => {
      oauthService.startAuthorization.mockResolvedValue({ flowId: 'f1' });
      await controller.start('my-agent', 'opencode', ctx);
      expect(oauthService.startAuthorization.mock.calls[0][3]).toBe('opencode');
    });

    it('rejects any other provider before touching the service', async () => {
      await expect(controller.start('my-agent', 'openai', ctx)).rejects.toMatchObject({
        message: 'provider must be opencode or opencode-go',
      });
      expect(oauthService.startAuthorization).not.toHaveBeenCalled();
    });

    it('answers 400 (not 503) for an invalid provider', async () => {
      await expect(controller.start('my-agent', 'openai', ctx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('maps a start failure to 503', async () => {
      oauthService.startAuthorization.mockRejectedValue(new Error('console down'));
      await expect(controller.start('my-agent', undefined, ctx)).rejects.toMatchObject({
        message: 'console down',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });

    it('uses a generic message for a non-Error failure', async () => {
      oauthService.startAuthorization.mockRejectedValue(42);
      await expect(controller.start('my-agent', undefined, ctx)).rejects.toMatchObject({
        message: 'Failed to start OpenCode login',
      });
    });

    it('propagates the not-found error of an agent outside the tenant', async () => {
      resolveAgent.resolve.mockRejectedValue(new NotFoundException('Agent not found'));
      await expect(controller.start('foreign', undefined, ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(oauthService.startAuthorization).not.toHaveBeenCalled();
    });
  });

  describe('GET poll', () => {
    it('rejects a missing flowId', async () => {
      await expect(controller.poll('', ctx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('404s without a tenant', async () => {
      await expect(
        controller.poll('f1', { tenantId: null, userId: 'user-1' } as TenantContext),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(oauthService.pollAuthorization).not.toHaveBeenCalled();
    });

    it('polls the flow scoped to the caller tenant', async () => {
      oauthService.pollAuthorization.mockResolvedValue({ status: 'pending' });
      await expect(controller.poll('f1', ctx)).resolves.toEqual({ status: 'pending' });
      expect(oauthService.pollAuthorization).toHaveBeenCalledWith('f1', 'tenant-1');
    });

    it('maps a poll failure to 503', async () => {
      oauthService.pollAuthorization.mockRejectedValue(new Error('flow expired'));
      const err = await controller.poll('f1', ctx).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(err.message).toBe('flow expired');
    });

    it('uses a generic message for a non-Error failure', async () => {
      oauthService.pollAuthorization.mockRejectedValue(null);
      await expect(controller.poll('f1', ctx)).rejects.toMatchObject({
        message: 'Failed to poll OpenCode login',
      });
    });
  });

  describe('POST revoke', () => {
    it('rejects a missing agentName', async () => {
      await expect(controller.revoke('', undefined, undefined, ctx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('removes the subscription connection of the resolved agent', async () => {
      const result = await controller.revoke('my-agent', ' work ', 'opencode', ctx);
      expect(providerService.removeProvider).toHaveBeenCalledWith(
        'agent-1',
        'tenant-1',
        'opencode',
        'subscription',
        'work',
      );
      expect(result).toEqual({ ok: true, notifications: ['n1'] });
    });

    it('defaults to opencode-go', async () => {
      await controller.revoke('my-agent', undefined, undefined, ctx);
      expect(providerService.removeProvider.mock.calls[0][2]).toBe('opencode-go');
    });

    it('rejects an unknown provider and removes nothing', async () => {
      await expect(
        controller.revoke('my-agent', undefined, 'anthropic', ctx),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(providerService.removeProvider).not.toHaveBeenCalled();
    });

    it('rejects a repeated label', async () => {
      await expect(controller.revoke('my-agent', ['a', 'b'], undefined, ctx)).rejects.toMatchObject(
        { status: HttpStatus.BAD_REQUEST },
      );
      expect(providerService.removeProvider).not.toHaveBeenCalled();
    });
  });
});
