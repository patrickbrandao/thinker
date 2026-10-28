import { Controller, Get, Param } from '@nestjs/common';
import type { ModelRoute } from 'thinker-shared';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { ResolveAgentService } from '../routing-core/resolve-agent.service';
import { ModelListRoutingService } from './model-list-routing.service';
import { VirtualModelService } from './virtual-model.service';
import { listedCatalogModels } from './model-list';

/** One row of a harness's Models tab: what `/v1/models` publishes, with details. */
export interface HarnessModelEntry {
  id: string;
  kind: 'auto' | 'virtual' | 'model';
  owned_by: string;
  context_length: number | null;
  /** Real models. */
  display_name?: string;
  provider?: string;
  provider_model_id?: string;
  auth_type?: string;
  input_price_per_token?: number | null;
  output_price_per_token?: number | null;
  reasoning?: boolean;
  code?: boolean;
  input_modalities?: readonly string[];
  output_modalities?: readonly string[];
  /** Virtual models. */
  primary?: ModelRoute | null;
  fallbacks?: ModelRoute[];
  continue_on_default?: boolean;
  response_mode?: string;
}

/**
 * The model list a harness gets from `GET /v1/models`, in the same order and
 * with the same listing mode and shadowing, plus the details the dashboard
 * shows. Read-only.
 */
@MinRole('admin')
@Controller('api/v1/routing')
export class ModelListController {
  constructor(
    private readonly resolveAgentService: ResolveAgentService,
    private readonly modelDiscovery: ModelDiscoveryService,
    private readonly modelListRouting: ModelListRoutingService,
    private readonly virtualModels: VirtualModelService,
  ) {}

  @Get(':agentName/model-list')
  async list(@TenantCtx() ctx: TenantContext, @Param('agentName') agentName: string) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, agentName);
    const [models, rows] = await Promise.all([
      this.modelDiscovery.getModelsForAgent(agent.tenant_id, agent.id),
      this.virtualModels.list(agent.id),
    ]);
    const routing = await this.modelListRouting.forAgent(agent.id, agent.tenant_id, models);
    const byName = new Map(rows.map((row) => [row.name, row]));

    const data: HarnessModelEntry[] = [
      {
        id: 'auto',
        kind: 'auto',
        owned_by: 'thinker',
        context_length: routing.autoContextLength,
      },
      ...routing.virtuals.map((v): HarnessModelEntry => {
        const row = byName.get(v.name);
        return {
          id: v.name,
          kind: 'virtual',
          owned_by: 'thinker',
          context_length: v.context_length,
          primary: row?.override_route ?? null,
          fallbacks: row?.fallback_routes ?? [],
          continue_on_default: row?.continue_on_default ?? false,
          response_mode: row?.response_mode ?? 'buffered',
        };
      }),
      ...listedCatalogModels(models, routing).map(({ id, model }): HarnessModelEntry => ({
        id,
        kind: 'model',
        owned_by: model.providerName ?? model.provider,
        context_length: model.contextWindow || null,
        display_name: model.displayName,
        provider: model.provider,
        provider_model_id: model.id,
        ...(model.authType ? { auth_type: model.authType } : {}),
        input_price_per_token: model.inputPricePerToken,
        output_price_per_token: model.outputPricePerToken,
        reasoning: model.capabilityReasoning,
        code: model.capabilityCode,
        ...(model.inputModalities ? { input_modalities: model.inputModalities } : {}),
        ...(model.outputModalities ? { output_modalities: model.outputModalities } : {}),
      })),
    ];
    return { listing: routing.listing ?? 'open', data };
  }
}
