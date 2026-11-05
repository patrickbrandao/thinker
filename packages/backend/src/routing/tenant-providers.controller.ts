import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { ModelPricingCacheService } from '../model-prices/model-pricing-cache.service';
import { CustomProviderService } from './custom-provider/custom-provider.service';
import { ProviderService } from './routing-core/provider.service';
import { RoutingCacheService } from './routing-core/routing-cache.service';
import { ModelDiscoveryService } from '../model-discovery/model-discovery.service';
import {
  ProviderKeyParamDto,
  ProviderParamDto,
  RemoveProviderQueryDto,
  RenameProviderKeyDto,
  SetStreamWarmupDto,
  SetBaseUrlDto,
} from './dto/routing.dto';
import { MinRole } from '../common/decorators/roles.decorator';
import { OrganizationsService } from '../organizations/organizations.service';
import { providerKeyDisplay } from '../common/utils/provider-key-mask';
import { checkAccountBaseUrl, baseUrlFields } from './account-base-url-check';
import { defaultAccountBaseUrl, supportsAccountBaseUrl } from './account-base-url';
import { buildProviderModels } from './provider-models';

/**
 * Tenant-level provider management endpoints.
 * Returns all providers for the tenant (not scoped to a specific agent).
 *
 * CONFIG ONLY. This endpoint must stay cheap: it reads `tenant_providers`
 * (small) plus the in-memory pricing cache, and never touches `agent_messages`.
 * Usage stats (consumption_*, last_used_at, sparkline_7d) moved to
 * `GET /api/v1/providers/usage` (ProviderUsageController) so a config read no
 * longer triggers two multi-second scans over the 8GB messages table. The
 * frontend fetches the two halves independently and merges by
 * (provider, auth_type).
 *
 * The mutations below (disconnect, rename, refresh) are the tenant-level
 * twins of the `/routing/:agentName/providers/*` routes. Connections belong to
 * the tenant, so managing one must not require a harness to exist.
 */
@MinRole('admin')
@Controller('api/v1/providers')
export class TenantProvidersController {
  private readonly logger = new Logger(TenantProvidersController.name);

  constructor(
    @InjectRepository(TenantProvider)
    private readonly providerRepo: Repository<TenantProvider>,
    private readonly pricingCache: ModelPricingCacheService,
    private readonly customProviderService: CustomProviderService,
    private readonly providerService: ProviderService,
    private readonly discoveryService: ModelDiscoveryService,
    private readonly routingCache: RoutingCacheService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly organizations: OrganizationsService,
  ) {}

  private requireTenant(ctx: TenantContext): string {
    if (!ctx.tenantId) throw new NotFoundException('Provider not found');
    return ctx.tenantId;
  }

  /** Drop every routing cache that can hold a now-stale view of the tenant's providers. */
  private async invalidateTenantRouting(tenantId: string): Promise<void> {
    for (const agentId of await this.providerService.listOwnedAgentIds(tenantId)) {
      this.routingCache.invalidateAgent(agentId);
    }
    this.routingCache.invalidateTenant(tenantId);
  }

  /**
   * Every model the workspace's connections offer (Providers → Models), with
   * the accounts serving each one. Active connections only, unless
   * `include_inactive=true`.
   */
  @Get('models')
  async listModels(
    @TenantCtx() ctx: TenantContext,
    @Query('include_inactive') includeInactive?: string,
  ) {
    const tenantId = this.requireTenant(ctx);
    const [rows, customProviders] = await Promise.all([
      this.providerRepo.find({ where: { tenant_id: tenantId } }),
      this.customProviderService.list(tenantId),
    ]);
    return {
      models: buildProviderModels(rows, customProviders, includeInactive === 'true'),
    };
  }

  /** Official base URL of a provider (and region), for the base URL field's placeholder. */
  @Get('default-base-url')
  defaultBaseUrl(
    @Query('provider') provider: string,
    @Query('auth_type') authType?: string,
    @Query('region') region?: string,
  ) {
    const supports = !!provider && supportsAccountBaseUrl(provider, authType || 'api_key');
    return {
      supports_base_url: supports,
      default_base_url: supports
        ? defaultAccountBaseUrl(provider, authType || 'api_key', region || null)
        : null,
    };
  }

  @Post('refresh-models')
  async refreshModels(@TenantCtx() ctx: TenantContext) {
    const tenantId = this.requireTenant(ctx);
    await this.discoveryService.discoverAllForAgent(tenantId, { forceRefresh: true });
    await this.invalidateTenantRouting(tenantId);
    return { ok: true };
  }

  @Patch(':provider/keys/:label')
  async renameProviderKey(
    @TenantCtx() ctx: TenantContext,
    @Param() params: ProviderKeyParamDto,
    @Body() body: RenameProviderKeyDto,
  ) {
    const tenantId = this.requireTenant(ctx);
    const updated = await this.providerService.renameKey(
      null,
      tenantId,
      params.provider,
      body.authType ?? 'api_key',
      params.label,
      body.newLabel,
    );
    await this.invalidateTenantRouting(tenantId);
    return {
      id: updated.id,
      provider: updated.provider,
      auth_type: updated.auth_type,
      label: updated.label,
      priority: updated.priority,
    };
  }

  /**
   * Set or clear an API-key connection's base URL. Same URL rules as custom
   * providers: SSRF validation with THINKER_PROVIDER_PRIVATE_URLS. Models are
   * discovered again against the new URL.
   */
  @Patch('connections/:id/base-url')
  async setBaseUrl(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: SetBaseUrlDto,
  ) {
    const tenantId = this.requireTenant(ctx);
    const baseUrl = await checkAccountBaseUrl(body.base_url, ctx);
    const updated = await this.providerService.setBaseUrl(tenantId, id, baseUrl);
    await this.invalidateTenantRouting(tenantId);
    try {
      await this.discoveryService.discoverModels(updated);
    } catch {
      // Non-fatal: "Refresh models" retries.
    }
    return {
      id: updated.id,
      base_url: updated.base_url ?? null,
      default_base_url: defaultAccountBaseUrl(updated.provider, updated.auth_type, updated.region),
    };
  }

  /** Set or clear a connection's stream warm-up override (#244). */
  @Patch('connections/:id/stream-warmup')
  async setStreamWarmup(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: SetStreamWarmupDto,
  ) {
    const tenantId = this.requireTenant(ctx);
    const updated = await this.providerService.setStreamWarmup(tenantId, id, body.stream_warmup_ms);
    await this.invalidateTenantRouting(tenantId);
    return { id: updated.id, stream_warmup_ms: updated.stream_warmup_ms };
  }

  /**
   * Reveal a connection's full API key. Owner only: the RolesGuard checks the
   * role resolved for the request, and the membership is re-checked here so a
   * credential without a user (or an internal context) never passes. OAuth and
   * subscription credentials are refused. Every reveal is logged without the key.
   */
  @MinRole('owner')
  @Post('connections/:id/reveal-key')
  @Header('Cache-Control', 'no-store')
  async revealKey(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    const tenantId = this.requireTenant(ctx);
    if (!ctx.userId) {
      throw new ForbiddenException({
        message: 'Only an organization owner can reveal a provider key.',
        code: 'insufficient_role',
      });
    }
    await this.organizations.require(ctx.userId, tenantId, 'owner');
    const { row, apiKey } = await this.providerService.revealApiKey(tenantId, id);
    this.logger.log(
      `Provider key revealed: user=${ctx.userId} tenant=${tenantId} connection=${row.id} provider=${row.provider}`,
    );
    return { id: row.id, api_key: apiKey };
  }

  /**
   * Arm a re-authentication: the next subscription sign-in for this
   * connection's provider updates this connection in place.
   */
  @Post('connections/:id/reauth')
  async startReauth(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    const tenantId = this.requireTenant(ctx);
    const row = await this.providerService.startReauth(tenantId, id);
    return { id: row.id, provider: row.provider, label: row.label };
  }

  @Delete('connections/:id/reauth')
  async cancelReauth(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    const tenantId = this.requireTenant(ctx);
    await this.providerService.cancelReauth(tenantId, id);
    return { ok: true };
  }

  @Delete(':provider')
  async removeProvider(
    @TenantCtx() ctx: TenantContext,
    @Param() params: ProviderParamDto,
    @Query() query: RemoveProviderQueryDto,
  ) {
    const tenantId = this.requireTenant(ctx);
    const { notifications } = await this.providerService.removeProvider(
      null,
      tenantId,
      params.provider,
      query.authType,
      query.label,
    );
    await this.invalidateTenantRouting(tenantId);
    await this.cacheManager.clear();
    return { ok: true, notifications };
  }

  /**
   * List all tenant-level providers (config only). Groups by
   * (provider, auth_type) and returns the connected keys, model counts, and
   * display names. No usage aggregation — see ProviderUsageController.
   */
  @Get()
  async listProviders(@TenantCtx() ctx: TenantContext) {
    const tenantId = ctx.tenantId;
    const providers = tenantId
      ? await this.providerRepo.find({ where: { tenant_id: tenantId } })
      : [];

    // Group providers and build response
    const grouped = new Map<
      string,
      {
        provider: string;
        auth_type: string;
        connections: Array<{
          id: string;
          label: string;
          key_prefix: string | null;
          key_masked: string | null;
          priority: number;
          connected_at: string;
          models_fetched_at: string | null;
          cached_model_count: number;
          is_active: boolean;
          stream_warmup_ms: number | null;
          region: string | null;
          base_url: string | null;
          default_base_url: string | null;
          supports_base_url: boolean;
        }>;
        total_models: number;
      }
    >();

    // A custom provider's models are entered by hand on its custom_providers
    // row; discovery never fills the connection's cached_models.
    const customProviders = tenantId ? await this.customProviderService.list(tenantId) : [];
    const customModelCount = new Map(
      customProviders.map((cp) => [
        `custom:${cp.id}`,
        Array.isArray(cp.models) ? cp.models.length : 0,
      ]),
    );

    for (const p of providers) {
      const key = `${p.provider}::${p.auth_type}`;
      const existing = grouped.get(key);
      const modelCount =
        customModelCount.get(p.provider) ??
        (Array.isArray(p.cached_models) ? p.cached_models.length : 0);
      const display = providerKeyDisplay(p);

      if (existing) {
        existing.connections.push({
          id: p.id,
          label: p.label,
          ...display,
          priority: p.priority,
          connected_at: p.connected_at,
          models_fetched_at: p.models_fetched_at,
          cached_model_count: modelCount,
          is_active: p.is_active,
          stream_warmup_ms: p.stream_warmup_ms ?? null,
          ...baseUrlFields(p),
        });
        existing.total_models = Math.max(existing.total_models, modelCount);
      } else {
        grouped.set(key, {
          provider: p.provider,
          auth_type: p.auth_type,
          connections: [
            {
              id: p.id,
              label: p.label,
              ...display,
              priority: p.priority,
              connected_at: p.connected_at,
              models_fetched_at: p.models_fetched_at,
              cached_model_count: modelCount,
              is_active: p.is_active,
              stream_warmup_ms: p.stream_warmup_ms ?? null,
              ...baseUrlFields(p),
            },
          ],
          total_models: modelCount,
        });
      }
    }

    // Resolve custom provider display names (provider key = `custom:<uuid>`).
    const customNameById = new Map(customProviders.map((cp) => [cp.id, cp.name]));

    const result = Array.from(grouped.values()).map((g) => ({
      provider: g.provider,
      auth_type: g.auth_type,
      display_name: g.provider.startsWith('custom:')
        ? (customNameById.get(g.provider.slice('custom:'.length)) ?? null)
        : null,
      connection_count: g.connections.length,
      connections: g.connections,
      total_models: g.total_models,
    }));

    // Count models per provider from the global pricing cache (covers all providers, connected or not)
    const allPricing = this.pricingCache.getAll();
    const modelCountByProvider = new Map<string, number>();
    for (const entry of allPricing) {
      const prov = entry.provider?.toLowerCase();
      if (prov) {
        modelCountByProvider.set(prov, (modelCountByProvider.get(prov) ?? 0) + 1);
      }
    }

    return {
      providers: result,
      model_counts: Object.fromEntries(modelCountByProvider),
    };
  }
}
