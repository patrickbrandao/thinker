import { Body, Controller, Delete, Get, Param, Post, Put, Optional } from '@nestjs/common';
import { ProxyEgressService } from '../../proxy-servers/proxy-egress.service';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import {
  CustomProviderService,
  primaryCustomConnection,
  resolveLocalServerConfig,
} from './custom-provider.service';
import type { CustomProvider } from '../../entities/custom-provider.entity';
import {
  LOCAL_SERVER_TYPES,
  LOCAL_SERVER_TYPE_DEFAULTS,
  defaultLocalServerConfig,
  localServerBaseUrl,
} from '../../common/constants/local-servers';
import { ProviderService } from '../routing-core/provider.service';
import { ResolveAgentService } from '../routing-core/resolve-agent.service';
import {
  CreateCustomProviderDto,
  ProbeCustomProviderDto,
  UpdateCustomProviderDto,
} from '../dto/custom-provider.dto';
import { AgentNameParamDto } from '../dto/routing.dto';
import { MinRole } from '../../common/decorators/roles.decorator';
import { canUsePrivateDestinations } from '../../common/utils/private-url-policy';
import type { TenantProvider } from '../../entities/tenant-provider.entity';
import { PROVIDER_CONNECTION_SCOPE } from '../routing-core/resolve-agent.service';

/**
 * The provider's key pool in the order the proxy tries it. Keys are managed
 * through the shared provider endpoints (`POST providers`, `PATCH
 * providers/:provider/keys/:label`, `PUT providers/:provider/keys/order`,
 * `DELETE providers/:provider?label=`) with `provider = custom:<id>`.
 */
function keyPool(rows: readonly TenantProvider[], providerKey: string) {
  return rows
    .filter((r) => r.provider === providerKey && r.is_active && !!r.api_key_encrypted)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((r) => ({ label: r.label, key_prefix: r.key_prefix ?? null, priority: r.priority }));
}

/** API shape of one custom provider (local servers included). The API key never leaves. */
function toResponse(cp: CustomProvider, tenantProviders: readonly TenantProvider[]) {
  const provKey = CustomProviderService.providerKey(cp.id);
  const up = primaryCustomConnection(tenantProviders, provKey);
  return {
    id: cp.id,
    name: cp.name,
    alias: cp.alias,
    base_url: cp.base_url,
    api_kind: cp.api_kind,
    local_type: cp.local_type ?? null,
    local_config: cp.local_config ?? null,
    has_api_key: !!up?.api_key_encrypted,
    keys: keyPool(tenantProviders, provKey),
    stream_warmup_ms: up?.stream_warmup_ms ?? null,
    models: cp.models,
    created_at: cp.created_at,
  };
}

@MinRole('admin')
@Controller('api/v1/routing')
export class CustomProviderController {
  constructor(
    private readonly customProviderService: CustomProviderService,
    private readonly providerService: ProviderService,
    private readonly resolveAgentService: ResolveAgentService,
    @Optional() private readonly egress?: ProxyEgressService,
  ) {}

  @Get(':agentName/custom-providers')
  async list(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    // Resolve for authz — the tenant must own the agent. Custom providers are
    // tenant-global, so the listing itself is scoped to the tenant, not the agent.
    // allowPlayground: true — the Playground page reads custom providers for the
    // reserved Playground agent; all mutation endpoints remain blocked.
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName, {
      allowPlayground: true,
    });
    const [providers, tenantProviders] = await Promise.all([
      this.customProviderService.list(agent.tenant_id),
      this.providerService.getProviders(agent.tenant_id),
    ]);
    return providers.map((cp) => toResponse(cp, tenantProviders));
  }

  /**
   * Pre-filled settings of a new local server, per type: the container host
   * alias (or the type's env var, OLLAMA_HOST / THINKER_*_BASE_URL) and the
   * documented port.
   */
  @Get(':agentName/custom-providers/local-defaults')
  async localDefaults(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    await this.resolveAgentService.resolve(ctx.tenantId, params.agentName, {
      allowPlayground: true,
    });
    return LOCAL_SERVER_TYPES.map((type) => ({
      type,
      display_name: LOCAL_SERVER_TYPE_DEFAULTS[type].displayName,
      env: LOCAL_SERVER_TYPE_DEFAULTS[type].env,
      default_port: LOCAL_SERVER_TYPE_DEFAULTS[type].defaultPort,
      config: defaultLocalServerConfig(type),
    }));
  }

  @Post(':agentName/custom-providers/probe')
  async probe(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Body() body: ProbeCustomProviderDto,
  ) {
    // Resolve for authz — the tenant must own the agent before the server
    // probes anything on its behalf.
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    // Edit-mode fallback: the form has no plaintext key when re-opened
    // (list() only exposes has_api_key:bool), so it forwards provider_id
    // and we reuse the stored key. The service only releases it for the
    // provider's own tenant, base URL and api_kind, so the key can't be
    // sent to a different server. A user-typed apiKey always wins.
    const localConfig = body.local_type
      ? resolveLocalServerConfig(body.local_type, body.local_config)
      : null;
    const baseUrl = localConfig ? localServerBaseUrl(localConfig) : body.base_url;
    const apiKey =
      body.apiKey ??
      (body.provider_id
        ? await this.customProviderService.loadStoredApiKey(
            agent.tenant_id,
            body.provider_id,
            baseUrl,
            localConfig ? 'openai' : body.api_kind,
          )
        : undefined);
    if (body.local_type && localConfig) {
      const result = await this.customProviderService.probeLocal(
        body.local_type,
        localConfig,
        apiKey,
        { allowPrivate: canUsePrivateDestinations(ctx) },
      );
      return { ...result, base_url: baseUrl };
    }
    const probe = () =>
      this.customProviderService.probeModels(
        body.base_url,
        apiKey,
        body.api_kind,
        body.provider_name,
        { allowPrivate: canUsePrivateDestinations(ctx) },
      );
    // An existing provider is probed through its outbound proxy chain.
    const models =
      body.provider_id && this.egress
        ? await this.egress.runForConnection(
            agent.tenant_id,
            `custom:${body.provider_id}`,
            null,
            probe,
          )
        : await probe();
    return { models };
  }

  @Post(':agentName/custom-providers')
  async create(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
    @Body() body: CreateCustomProviderDto,
  ) {
    // allowPlayground: true — creating a custom provider from the Playground page is
    // additive (tenant-global resource); the playground agent is a valid owner context.
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName, {
      allowPlayground: true,
    });
    const cp = await this.customProviderService.create(agent.tenant_id, body, ctx.userId, {
      allowPrivate: canUsePrivateDestinations(ctx),
    });
    return toResponse(cp, await this.providerService.getProviders(agent.tenant_id));
  }

  @Put(':agentName/custom-providers/:id')
  async update(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
    @Body() body: UpdateCustomProviderDto,
  ) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    const cp = await this.customProviderService.update(id, agent.tenant_id, body, ctx.userId, {
      allowPrivate: canUsePrivateDestinations(ctx),
    });
    return toResponse(cp, await this.providerService.getProviders(agent.tenant_id));
  }

  @Delete(':agentName/custom-providers/:id')
  async remove(
    @TenantCtx() ctx: TenantContext,
    @Param('agentName') agentName: string,
    @Param('id') id: string,
  ) {
    const agent = await this.resolveAgentService.resolve(
      ctx.tenantId,
      agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    await this.customProviderService.remove(agent.tenant_id, id, ctx.userId);
    return { ok: true };
  }
}
