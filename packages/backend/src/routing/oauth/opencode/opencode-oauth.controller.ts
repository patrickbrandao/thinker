import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { OutboundProviderScope } from '../../../proxy-servers/outbound-provider-scope.interceptor';
import { TenantCtx, TenantContext } from '../../../common/decorators/tenant-context.decorator';
import { OpencodeOauthService, type OpencodeConsoleProvider } from './opencode-oauth.service';
import { ResolveAgentService } from '../../routing-core/resolve-agent.service';
import { ProviderService } from '../../routing-core/provider.service';
import { ProviderKeyService } from '../../routing-core/provider-key.service';
import { optionalTrimmedStringQuery } from '../core/query-params';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { PROVIDER_CONNECTION_SCOPE } from '../../routing-core/resolve-agent.service';

@MinRole('admin', { includeReads: true })
@UseInterceptors(OutboundProviderScope('opencode-go'))
@Controller('api/v1/oauth/opencode')
export class OpencodeOauthController {
  constructor(
    private readonly oauthService: OpencodeOauthService,
    private readonly resolveAgent: ResolveAgentService,
    private readonly providerService: ProviderService,
    private readonly providerKeys: ProviderKeyService,
  ) {}

  /** The OpenCode Go allowance meter of the agent's Console login, or null. */
  @Get('usage')
  async usage(
    @Query('agentName') agentName: string,
    @Query('label') label: string | string[] | undefined,
    @TenantCtx() ctx: TenantContext,
  ) {
    if (!agentName) {
      throw new HttpException('agentName query parameter is required', HttpStatus.BAD_REQUEST);
    }
    const keyLabel = optionalTrimmedStringQuery(label, 'label');
    const agent = await this.resolveAgent.resolve(ctx.tenantId, agentName);
    const rawValue = await this.providerKeys.getProviderApiKey(
      agent.tenant_id,
      'opencode-go',
      'subscription',
      keyLabel,
      agent.id,
    );
    if (!rawValue) return { usage: null };
    try {
      return {
        usage: await this.oauthService.readGoUsage(rawValue, agent.id, agent.tenant_id, keyLabel),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read OpenCode Go usage';
      throw new HttpException(message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Post('start')
  async start(
    @Query('agentName') agentName: string,
    @Query('provider') provider: string | undefined,
    @TenantCtx() ctx: TenantContext,
  ) {
    if (!agentName) {
      throw new HttpException('agentName query parameter is required', HttpStatus.BAD_REQUEST);
    }
    const agent = await this.resolveAgent.resolve(
      ctx.tenantId,
      agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    try {
      return await this.oauthService.startAuthorization(
        agent.id,
        agent.tenant_id,
        ctx.userId,
        consoleProvider(provider),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start OpenCode login';
      throw new HttpException(message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get('poll')
  async poll(@Query('flowId') flowId: string, @TenantCtx() ctx: TenantContext) {
    if (!flowId) {
      throw new HttpException('flowId query parameter is required', HttpStatus.BAD_REQUEST);
    }
    if (!ctx.tenantId) {
      throw new NotFoundException('Tenant not found');
    }
    try {
      return await this.oauthService.pollAuthorization(flowId, ctx.tenantId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to poll OpenCode login';
      throw new HttpException(message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Post('revoke')
  async revoke(
    @Query('agentName') agentName: string,
    @Query('label') label: string | string[] | undefined,
    @Query('provider') provider: string | undefined,
    @TenantCtx() ctx: TenantContext,
  ) {
    if (!agentName) {
      throw new HttpException('agentName query parameter is required', HttpStatus.BAD_REQUEST);
    }
    const keyLabel = optionalTrimmedStringQuery(label, 'label');
    const agent = await this.resolveAgent.resolve(
      ctx.tenantId,
      agentName,
      PROVIDER_CONNECTION_SCOPE,
    );
    const { notifications } = await this.providerService.removeProvider(
      agent.id,
      agent.tenant_id,
      consoleProvider(provider),
      'subscription',
      keyLabel,
    );
    return { ok: true, notifications };
  }
}

/** The provider a Console login connects; OpenCode Go when unspecified. */
function consoleProvider(provider: string | undefined): OpencodeConsoleProvider {
  if (provider === undefined || provider === 'opencode-go') return 'opencode-go';
  if (provider === 'opencode') return 'opencode';
  throw new HttpException('provider must be opencode or opencode-go', HttpStatus.BAD_REQUEST);
}
