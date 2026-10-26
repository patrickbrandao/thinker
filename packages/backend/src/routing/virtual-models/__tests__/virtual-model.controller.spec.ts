import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VirtualModelController } from '../virtual-model.controller';
import type { VirtualModelService } from '../virtual-model.service';
import type { ResolveAgentService } from '../../routing-core/resolve-agent.service';
import type { TenantContext } from '../../../common/decorators/tenant-context.decorator';
import {
  CreateVirtualModelDto,
  ReorderVirtualModelsDto,
  ToggleVirtualModelDto,
  UpdateVirtualModelDto,
} from '../virtual-model.dto';

function makeController() {
  const service = {
    listViews: jest.fn().mockResolvedValue(['views']),
    create: jest.fn().mockResolvedValue({ id: 'vm-1' }),
    update: jest.fn().mockResolvedValue({ id: 'vm-1' }),
    setEnabled: jest.fn().mockResolvedValue({ id: 'vm-1', enabled: false }),
    setResponseMode: jest.fn().mockResolvedValue({ id: 'vm-1' }),
    delete: jest.fn().mockResolvedValue(undefined),
    reorder: jest.fn().mockResolvedValue(undefined),
    setOverride: jest.fn().mockResolvedValue({ id: 'vm-1' }),
    clearOverride: jest.fn().mockResolvedValue(undefined),
    setFallbacks: jest.fn().mockResolvedValue([]),
    clearFallbacks: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VirtualModelService>;
  const resolveAgentService = {
    resolve: jest.fn().mockResolvedValue({ id: 'agent-1', tenant_id: 'tenant-1' }),
  } as unknown as jest.Mocked<ResolveAgentService>;
  return {
    controller: new VirtualModelController(service, resolveAgentService),
    service,
    resolveAgentService,
  };
}

const ctx: TenantContext = { tenantId: 'tenant-1', userId: 'user-1' };

describe('VirtualModelController', () => {
  it('list resolves the agent in the caller tenant and returns views', async () => {
    const { controller, service, resolveAgentService } = makeController();
    expect(await controller.list(ctx, 'my-agent')).toEqual(['views']);
    expect(resolveAgentService.resolve).toHaveBeenCalledWith('tenant-1', 'my-agent');
    expect(service.listViews).toHaveBeenCalledWith('agent-1', 'tenant-1');
  });

  it('create passes the body with the agent tenant', async () => {
    const { controller, service } = makeController();
    const body = { name: 'deepseek' } as CreateVirtualModelDto;
    await controller.create(ctx, 'my-agent', body);
    expect(service.create).toHaveBeenCalledWith('agent-1', 'tenant-1', body);
  });

  it('update, toggle and delete scope to the resolved agent', async () => {
    const { controller, service } = makeController();
    await controller.update(ctx, 'a', 'vm-1', { continue_on_default: true });
    expect(service.update).toHaveBeenCalledWith('agent-1', 'tenant-1', 'vm-1', {
      continue_on_default: true,
    });
    await controller.toggle(ctx, 'a', 'vm-1', { enabled: false });
    expect(service.setEnabled).toHaveBeenCalledWith('agent-1', 'tenant-1', 'vm-1', false);
    expect(await controller.delete(ctx, 'a', 'vm-1')).toEqual({ ok: true });
    expect(service.delete).toHaveBeenCalledWith('agent-1', 'vm-1');
  });

  it('setResponseMode accepts both spellings and rejects a missing value', async () => {
    const { controller, service } = makeController();
    await controller.setResponseMode(ctx, 'a', 'vm-1', { responseMode: 'stream' });
    expect(service.setResponseMode).toHaveBeenCalledWith('agent-1', 'tenant-1', 'vm-1', 'stream');
    await expect(controller.setResponseMode(ctx, 'a', 'vm-1', {})).rejects.toThrow(
      'response_mode is required',
    );
  });

  it('reorder validates the body', async () => {
    const { controller, service } = makeController();
    expect(await controller.reorder(ctx, 'a', { ids: ['x'] })).toEqual({ ok: true });
    expect(service.reorder).toHaveBeenCalledWith('agent-1', ['x']);
    await expect(controller.reorder(ctx, 'a', {} as ReorderVirtualModelsDto)).rejects.toThrow(
      'body.ids must be an array',
    );
  });

  it('setOverride prefers the nested route over the flat fields', async () => {
    const { controller, service } = makeController();
    await controller.setOverride(ctx, 'a', 'vm-1', {
      model: 'flat',
      provider: 'flatp',
      providerKeyLabel: 'Flat',
      route: { model: 'gpt-4o', provider: 'openai', authType: 'api_key', keyLabel: 'Work' },
    });
    expect(service.setOverride).toHaveBeenCalledWith('agent-1', 'tenant-1', 'vm-1', {
      model: 'gpt-4o',
      provider: 'openai',
      authType: 'api_key',
      keyLabel: 'Work',
    });
    await controller.setOverride(ctx, 'a', 'vm-1', { model: 'gpt-4o', providerKeyLabel: 'K' });
    expect(service.setOverride).toHaveBeenLastCalledWith('agent-1', 'tenant-1', 'vm-1', {
      model: 'gpt-4o',
      provider: undefined,
      authType: undefined,
      keyLabel: 'K',
    });
  });

  it('fallback and override clears delegate', async () => {
    const { controller, service } = makeController();
    await controller.setFallbacks(ctx, 'a', 'vm-1', { models: ['m'] });
    expect(service.setFallbacks).toHaveBeenCalledWith(
      'agent-1',
      'tenant-1',
      'vm-1',
      ['m'],
      undefined,
    );
    expect(await controller.clearFallbacks(ctx, 'a', 'vm-1')).toEqual({ ok: true });
    expect(await controller.clearOverride(ctx, 'a', 'vm-1')).toEqual({ ok: true });
    expect(service.clearOverride).toHaveBeenCalledWith('agent-1', 'vm-1');
  });

  it('propagates the 404 from agent resolution', async () => {
    const { controller, resolveAgentService, service } = makeController();
    (resolveAgentService.resolve as jest.Mock).mockRejectedValue(new Error('Agent not found'));
    await expect(controller.list(ctx, 'other')).rejects.toThrow('Agent not found');
    expect(service.listViews).not.toHaveBeenCalled();
  });
});

describe('virtual model DTOs', () => {
  const errorsOf = async (cls: new () => object, plain: object) =>
    (await validate(plainToInstance(cls, plain), { forbidUnknownValues: true })).map(
      (e) => e.property,
    );

  it('accepts a full create body', async () => {
    expect(
      await errorsOf(CreateVirtualModelDto, {
        name: 'deepseek/flash',
        override_route: { model: 'deepseek-chat', provider: 'deepseek', authType: 'api_key' },
        fallback_routes: [{ model: 'gpt-4o', keyLabel: ' Work ' }],
        continue_on_default: true,
        response_mode: 'stream',
        output_modality: 'text',
      }),
    ).toEqual([]);
  });

  it('trims fallback key labels', () => {
    const dto = plainToInstance(CreateVirtualModelDto, {
      name: 'x',
      fallback_routes: [{ model: 'm', keyLabel: ' Work ' }],
    });
    expect(dto.fallback_routes?.[0].keyLabel).toBe('Work');
  });

  it('rejects bad field types and more than 5 fallbacks', async () => {
    expect(
      await errorsOf(CreateVirtualModelDto, {
        name: 1,
        override_route: { provider: 'openai' },
        fallback_routes: Array.from({ length: 6 }, () => ({ model: 'm' })),
        continue_on_default: 'yes',
        response_mode: 'bogus',
        output_modality: 'image',
      }),
    ).toEqual(
      expect.arrayContaining([
        'name',
        'override_route',
        'fallback_routes',
        'continue_on_default',
        'response_mode',
        'output_modality',
      ]),
    );
  });

  it('validates update, toggle and reorder bodies', async () => {
    expect(await errorsOf(UpdateVirtualModelDto, {})).toEqual([]);
    expect(await errorsOf(UpdateVirtualModelDto, { continue_on_default: 'x' })).toEqual([
      'continue_on_default',
    ]);
    expect(await errorsOf(ToggleVirtualModelDto, {})).toEqual(['enabled']);
    expect(await errorsOf(ReorderVirtualModelsDto, { ids: [1] })).toEqual(['ids']);
  });
});
