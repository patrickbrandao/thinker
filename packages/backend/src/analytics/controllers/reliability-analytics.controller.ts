import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { RangeQueryDto } from '../../common/dto/range-query.dto';
import {
  RELIABILITY_TS_DIMENSIONS,
  ReliabilityStatsService,
} from '../services/reliability-stats.service';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { UserCacheInterceptor } from '../../common/interceptors/user-cache.interceptor';
import { DASHBOARD_CACHE_TTL_MS } from '../../common/constants/cache.constants';

class ReliabilityTimeseriesQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsString()
  @IsIn([...RELIABILITY_TS_DIMENSIONS])
  by?: string;

  @IsOptional()
  @IsString()
  failed_only?: string;
}

/**
 * Request reliability for the dashboard (success rate, fallback recoveries,
 * request status over time, per-harness/provider/model reliability).
 */
@Controller('api/v1/overview/reliability')
@UseInterceptors(UserCacheInterceptor)
@CacheTTL(DASHBOARD_CACHE_TTL_MS)
export class ReliabilityAnalyticsController {
  constructor(private readonly reliabilityStats: ReliabilityStatsService) {}

  @Get('stats')
  async getStats(@Query() query: RangeQueryDto, @TenantCtx() ctx: TenantContext) {
    return this.reliabilityStats.getStats({
      tenantId: ctx.tenantId,
      range: query.range,
      agentName: query.agent_name,
    });
  }

  @Get('timeseries')
  async getTimeseries(
    @Query() query: ReliabilityTimeseriesQueryDto,
    @TenantCtx() ctx: TenantContext,
  ) {
    return this.reliabilityStats.getTimeseries({
      tenantId: ctx.tenantId,
      range: query.range,
      by: query.by,
      agentName: query.agent_name,
      failedOnly: query.failed_only === 'true',
    });
  }

  @Get('per-agent')
  async getPerAgent(@Query() query: RangeQueryDto, @TenantCtx() ctx: TenantContext) {
    return this.reliabilityStats.getPerAgentStats({
      tenantId: ctx.tenantId,
      range: query.range,
    });
  }

  @Get('per-provider')
  async getPerProvider(@Query() query: RangeQueryDto, @TenantCtx() ctx: TenantContext) {
    return this.reliabilityStats.getPerProviderStats({
      tenantId: ctx.tenantId,
      range: query.range,
      agentName: query.agent_name,
    });
  }

  @Get('per-model')
  async getPerModel(@Query() query: RangeQueryDto, @TenantCtx() ctx: TenantContext) {
    return this.reliabilityStats.getPerModelStats({
      tenantId: ctx.tenantId,
      range: query.range,
      agentName: query.agent_name,
    });
  }
}
