import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ResolveService } from './resolve.service';
import { ResolveRequestDto } from '../dto/resolve-request.dto';
import { ResolveResponse } from '../dto/resolve-response';

@Controller('api/v1/routing')
@Public()
@UseGuards(AgentKeyAuthGuard)
export class ResolveController {
  // Harness keys (thk_) only resolve routes here. Connections and their
  // credentials are managed through the admin-only provider endpoints
  // (ADR 0006): a harness key must never write tenant_providers.
  constructor(private readonly resolveService: ResolveService) {}

  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @Body() body: ResolveRequestDto,
    @Req() req: Request & { ingestionContext: IngestionContext },
  ): Promise<ResolveResponse> {
    const { agentId, tenantId } = req.ingestionContext;
    return this.resolveService.resolve(
      agentId,
      tenantId,
      body.messages as { role: string; content?: unknown; [k: string]: unknown }[],
      body.tools,
      body.tool_choice,
      body.max_tokens,
      body.recentTiers,
      body.specificity,
    );
  }
}
