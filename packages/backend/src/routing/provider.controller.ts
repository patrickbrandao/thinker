import { Audit } from '../alerts/audit.decorator';
import { parseVertexDeployment } from './vertex-deployment';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { ProviderService } from './routing-core/provider.service';
import { CustomProviderService } from './custom-provider/custom-provider.service';
import { ResolveAgentService } from './routing-core/resolve-agent.service';
import { resolveRoutingStatus } from './routing-status';
import { TierService } from './routing-core/tier.service';
import { ModelDiscoveryService } from '../model-discovery/model-discovery.service';
import { OllamaSyncService } from '../database/ollama-sync.service';
import { PricingSyncService } from '../database/pricing-sync.service';
import {
  AgentNameParamDto,
  AgentProviderParamDto,
  AgentProviderKeyParamDto,
  ConnectProviderDto,
  RemoveProviderQueryDto,
  RenameProviderKeyDto,
  ReorderProviderKeysDto,
} from './dto/routing.dto';
import { QWEN_REGION_VALIDATION_MESSAGE, isQwenRegion } from './qwen-region';
import { getSubscriptionEndpointRegionConfig } from './subscription-region';
import { isBedrockProvider, isBedrockRegion } from './bedrock-region';
import {
  MINIMAX_API_KEY_REGION_VALIDATION_MESSAGE,
  isMinimaxRegion,
} from './oauth/minimax/minimax-oauth-helpers';
import { MinRole } from '../common/decorators/roles.decorator';
import { providerKeyDisplay } from '../common/utils/provider-key-mask';
import { isLocalOnlyProvider } from '../common/utils/provider-availability';
import {
  assertCanUseLocalRunners,
  canUsePrivateDestinations,
} from '../common/utils/private-url-policy';
import { PROVIDER_CONNECTION_SCOPE } from './routing-core/resolve-agent.service';
import { checkAccountBaseUrl } from './account-base-url-check';
import { supportsAccountBaseUrl } from './account-base-url';

@MinRole('admin')
@Controller('api/v1/routing')
export class ProviderController {
  constructor(
    private readonly providerService: ProviderService,
    private readonly discoveryService: ModelDiscoveryService,
    private readonly ollamaSync: OllamaSyncService,
    private readonly resolveAgentService: ResolveAgentService,
    private readonly tierService: TierService,
    private readonly pricingSync: PricingSyncService,
    private readonly customProviderService: CustomProviderService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * A custom provider takes connections the way a native one does, but only
   * API keys, and only once its definition exists in the tenant. Without a
   * label the write targets the provider's primary connection, whatever it is
   * named, instead of inserting a second row labeled 'Default'.
   */
  private async customConnectionLabel(
    tenantId: string,
    provider: string,
    body: ConnectProviderDto,
  ): Promise<string | undefined> {
    if ((body.authType ?? 'api_key') !== 'api_key') {
      throw new BadRequestException('Custom providers only take API key connections');
    }
    const id = provider.slice('custom:'.length);
    if (!(await this.customProviderService.getById(id, tenantId))) {
      throw new NotFoundException('Custom provider not found');
    }
    if (body.label) return body.label;
    return (await this.customProviderService.primaryConnection(tenantId, id))?.label;
  }

  @Get(':agentName/status')
  async getStatus(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      params.agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    return resolveRoutingStatus({
      providers: await this.providerService.getProviders(agent.tenant_id),
      hasRoutableTier: () => this.tierService.hasRoutableTier(agent.id),
      pricingCacheSize: () => this.pricingSync.getAll().size,
    });
  }

  @Get(':agentName/providers')
  async getProviders(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    // allowPlayground: true — the Playground page reads the provider list for the
    // reserved Playground agent. Destructive/config mutations (rename, reorder,
    // deactivate, remove) still reject it; only additive connect is allowed.
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName, {
      allowPlayground: true,
    });
    const providers = await this.providerService.getProviders(agent.tenant_id);
    return providers.map((p) => ({
      id: p.id,
      provider: p.provider,
      auth_type: p.auth_type ?? 'api_key',
      is_active: p.is_active,
      has_api_key: !!p.api_key_encrypted,
      ...providerKeyDisplay(p),
      label: p.label,
      priority: p.priority,
      region: p.region ?? null,
      connected_at: p.connected_at,
      models_fetched_at: p.models_fetched_at ?? null,
      cached_model_count: Array.isArray(p.cached_models) ? p.cached_models.length : 0,
    }));
  }

  @Audit({ entity: 'connection', action: 'created' })
  @Post(':agentName/providers')
  async upsertProvider(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
    @Body() body: ConnectProviderDto,
  ) {
    // allowPlayground: true — connecting a provider to the Playground agent
    // is additive and correct (enabled providers belong to the tenant-global pool).
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName, {
      allowPlayground: true,
    });
    const lowerProvider = body.provider.toLowerCase();
    // Local runners reach services on the host (#102, ADR 0006).
    if (isLocalOnlyProvider(lowerProvider)) assertCanUseLocalRunners(ctx);
    const isCustomProvider = lowerProvider.startsWith('custom:');
    const label = isCustomProvider
      ? await this.customConnectionLabel(agent.tenant_id, lowerProvider, body)
      : body.label;
    const isQwenProvider = lowerProvider === 'qwen' || lowerProvider === 'alibaba';
    const isMinimaxApiKey =
      lowerProvider === 'minimax' && (body.authType ?? 'api_key') === 'api_key';
    const qwenBaseUrl = body.baseUrl ?? body.base_url;
    const qwenRegion = qwenBaseUrl ?? body.region;
    const subscriptionRegionConfig = getSubscriptionEndpointRegionConfig(
      lowerProvider,
      body.authType,
    );

    if (qwenBaseUrl !== undefined && !isQwenProvider) {
      throw new BadRequestException('baseUrl is only supported for Alibaba/Qwen providers');
    }

    if (qwenBaseUrl !== undefined && body.region !== undefined) {
      throw new BadRequestException('Use either region or baseUrl for Alibaba/Qwen providers');
    }

    if (qwenRegion !== undefined || body.region !== undefined) {
      if (isQwenProvider) {
        if (!isQwenRegion(qwenRegion)) {
          throw new BadRequestException(QWEN_REGION_VALIDATION_MESSAGE);
        }
      } else if (isBedrockProvider(lowerProvider) && (body.authType ?? 'api_key') === 'api_key') {
        if (!isBedrockRegion(body.region)) {
          throw new BadRequestException('AWS Bedrock region must be a valid AWS region code');
        }
      } else if (subscriptionRegionConfig) {
        if (!subscriptionRegionConfig.isRegion(body.region)) {
          throw new BadRequestException(subscriptionRegionConfig.validationMessage);
        }
      } else if (lowerProvider === 'vertex') {
        // `express` (or empty) keeps express mode; otherwise `project/location`.
        if (body.region && body.region !== 'express' && !parseVertexDeployment(body.region)) {
          throw new BadRequestException(
            'Vertex AI needs project/location (for example my-project/us-central1) or express',
          );
        }
      } else if (isMinimaxApiKey) {
        if (!isMinimaxRegion(body.region)) {
          throw new BadRequestException(MINIMAX_API_KEY_REGION_VALIDATION_MESSAGE);
        }
      } else {
        throw new BadRequestException(
          'region is only supported for Alibaba/Qwen providers, AWS Bedrock, MiniMax, Xiaomi MiMo Token Plan, and Z.ai subscriptions',
        );
      }
    }

    const accountBaseUrl =
      body.accountBaseUrl !== undefined
        ? await checkAccountBaseUrl(body.accountBaseUrl, ctx)
        : undefined;
    if (accountBaseUrl && !supportsAccountBaseUrl(lowerProvider, body.authType)) {
      throw new BadRequestException(
        'Only API-key connections of a built-in provider take a base URL',
      );
    }

    // Sync Ollama models before connecting so tier assignment has data
    if (body.provider.toLowerCase() === 'ollama') {
      await this.ollamaSync.sync();
    }

    // The service handles enabled-provider rows itself: new rows fan out to
    // every owned agent, updates re-enable the connecting agent via
    // afterProviderChange — no controller-side insert needed.
    let { provider: result } = await this.providerService.upsertProvider(
      agent.id,
      agent.tenant_id,
      body.provider,
      body.apiKey,
      body.authType,
      qwenRegion,
      label,
      ctx.userId,
    );
    if (accountBaseUrl !== undefined) {
      result = await this.providerService.setBaseUrl(
        agent.tenant_id,
        result.id,
        accountBaseUrl,
        canUsePrivateDestinations(ctx),
      );
    }

    // Discover models before returning so the frontend sees updated model
    // availability immediately (typically ~1-3s). Route choices remain
    // user-controlled and are not recalculated here. A custom provider's
    // models live on its definition, so there is nothing to discover.
    if (!isCustomProvider) {
      try {
        await this.discoveryService.discoverModels(result);
      } catch {
        // Discovery failure is non-fatal — user can retry via "Refresh models"
      }
    }

    return {
      id: result.id,
      provider: result.provider,
      auth_type: result.auth_type ?? 'api_key',
      is_active: result.is_active,
      label: result.label,
      priority: result.priority,
      region: result.region ?? null,
    };
  }

  @Audit({
    entity: 'connection',
    action: 'updated',
    idParam: 'label',
    nameParams: ['provider', 'label'],
  })
  @Patch(':agentName/providers/:provider/keys/:label')
  async renameProviderKey(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentProviderKeyParamDto,
    @Body() body: RenameProviderKeyDto,
  ) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      params.agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    const updated = await this.providerService.renameKey(
      agent.id,
      agent.tenant_id,
      params.provider,
      body.authType ?? 'api_key',
      params.label,
      body.newLabel,
    );
    return {
      id: updated.id,
      provider: updated.provider,
      auth_type: updated.auth_type,
      label: updated.label,
      priority: updated.priority,
    };
  }

  @Audit({ entity: 'connection', action: 'updated', idParam: 'provider', nameParams: ['provider'] })
  @Put(':agentName/providers/:provider/keys/order')
  async reorderProviderKeys(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentProviderParamDto,
    @Body() body: ReorderProviderKeysDto,
  ) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      params.agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    const updated = await this.providerService.reorderKeys(
      agent.id,
      agent.tenant_id,
      params.provider,
      body.authType ?? 'api_key',
      body.labels,
    );
    return updated
      .sort((a, b) => a.priority - b.priority)
      .map((row) => ({
        id: row.id,
        label: row.label,
        priority: row.priority,
      }));
  }

  @Audit({
    entity: 'connection',
    action: 'updated',
    idParam: 'agentName',
    nameParams: ['agentName'],
  })
  @Post(':agentName/providers/deactivate-all')
  async deactivateAllProviders(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
  ) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      params.agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    await this.providerService.deactivateAllProviders(agent.id, agent.tenant_id);
    return { ok: true };
  }

  @Audit({ entity: 'connection', action: 'deleted', idParam: 'provider', nameParams: ['provider'] })
  @Delete(':agentName/providers/:provider')
  async removeProvider(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentProviderParamDto,
    @Query() query: RemoveProviderQueryDto,
  ) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      params.agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    const { notifications } = await this.providerService.removeProvider(
      agent.id,
      agent.tenant_id,
      params.provider,
      query.authType,
      query.label,
    );
    await this.cacheManager.clear();
    return { ok: true, notifications };
  }
}
