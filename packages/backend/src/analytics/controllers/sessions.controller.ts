import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { hasRole } from '../../common/guards/roles.guard';
import { SessionsService } from '../services/sessions.service';

export class SessionsQueryDto {
  @IsOptional()
  @IsString()
  range?: string;

  @IsOptional()
  @IsString()
  agent_name?: string;

  @IsOptional()
  @Matches(/^\d{1,3}$/)
  limit?: string;

  @IsOptional()
  @Matches(/^\d{1,6}$/)
  offset?: string;
}

@Controller('api/v1')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('sessions')
  list(@Query() query: SessionsQueryDto, @TenantCtx() ctx: TenantContext) {
    if (!ctx.tenantId) return { items: [], has_more: false };
    return this.sessions.list({
      tenantId: ctx.tenantId,
      range: query.range,
      agentName: query.agent_name || undefined,
      limit: Math.min(Math.max(Number(query.limit ?? 50), 1), 200),
      offset: Number(query.offset ?? 0),
    });
  }

  @Get('sessions/:id')
  async get(@Param('id') id: string, @TenantCtx() ctx: TenantContext) {
    if (!ctx.tenantId) throw new NotFoundException();
    // The client comes from recorded headers, which only admins may read.
    const withClient =
      ctx.isInstanceAdmin || ctx.role === undefined || hasRole(ctx.role ?? 'viewer', 'admin');
    const session = await this.sessions.get(ctx.tenantId, id, withClient);
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }
}
