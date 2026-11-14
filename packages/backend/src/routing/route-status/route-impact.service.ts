import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { DEFAULT_TIER_SLOT, isRouteDisabled, type ModelRoute } from 'thinker-shared';
import { Agent } from '../../entities/agent.entity';
import { VirtualModel } from '../../entities/virtual-model.entity';
import { TierAssignment } from '../../entities/tier-assignment.entity';
import { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import { expandProviderNames } from '../../common/constants/providers';
import { emitAlert } from '../../common/services/alert-sink';
import {
  setModelCatalogChangeListener,
  type ModelCatalogChange,
} from '../../model-discovery/model-catalog-change';
import { readFallbackRoutes, readOverrideRoute } from '../routing-core/route-helpers';
import {
  routeOutOfServiceReason,
  snapshotRouteState,
  virtualModelRoutable,
  type RouteSnapshot,
} from '../virtual-models/virtual-model-chain';
import { RouteStatusService } from './route-status.service';

/** One stored route a catalog change affects. */
export interface AffectedRoute {
  agent_id: string;
  harness: string;
  chain: 'virtual_model' | 'tier' | 'specificity';
  /** Virtual model name, tier slot or category. */
  name: string;
  /** `primary` or `fallback N` (1-based). */
  position: string;
  disabled: boolean;
  /** False when the chain has no route left to serve (out of service). */
  chain_routable: boolean;
}

interface ChainRow {
  agent_id: string;
  override_route: ModelRoute | null;
  fallback_routes: ModelRoute[] | null;
}

/**
 * Emits `route.out_of_service` and `route.restored` when a discovery drops or
 * brings back a model that some harness's chain (virtual model, tier or
 * specificity category) uses: one event per model and connection, listing
 * every harness and chain affected. A route counts only when the agent's
 * catalog now agrees (another connection of the same provider may still list
 * the model). Disabled routes are listed as such and stay disabled.
 */
@Injectable()
export class RouteImpactService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RouteImpactService.name);

  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(VirtualModel) private readonly virtualRepo: Repository<VirtualModel>,
    @InjectRepository(TierAssignment) private readonly tierRepo: Repository<TierAssignment>,
    @InjectRepository(SpecificityAssignment)
    private readonly specificityRepo: Repository<SpecificityAssignment>,
    private readonly routeStatus: RouteStatusService,
  ) {}

  onModuleInit(): void {
    setModelCatalogChangeListener((change) => this.onChange(change));
  }

  onModuleDestroy(): void {
    setModelCatalogChangeListener(null);
  }

  async onChange(change: ModelCatalogChange): Promise<void> {
    try {
      const [removed, restored] = await Promise.all([
        this.affected(change, change.removed, true),
        this.affected(change, change.added, false),
      ]);
      for (const [model, routes] of removed) this.emit(change, model, routes, true);
      for (const [model, routes] of restored) this.emit(change, model, routes, false);
    } catch (err) {
      this.logger.warn(`Route impact of a catalog change failed: ${String(err)}`);
    }
  }

  /** Model id → stored routes of the tenant's chains it affects. */
  async affected(
    change: ModelCatalogChange,
    models: readonly string[],
    removed: boolean,
  ): Promise<Map<string, AffectedRoute[]>> {
    const out = new Map<string, AffectedRoute[]>();
    if (models.length === 0) return out;
    const wanted = new Set(models);
    const conn = change.connection;
    const names = expandProviderNames([conn.provider]);
    const onConnection = (r: ModelRoute) =>
      wanted.has(r.model) &&
      [...expandProviderNames([r.provider])].some((n) => names.has(n)) &&
      (!r.authType || r.authType === conn.auth_type) &&
      (!r.keyLabel || !conn.label || r.keyLabel.toLowerCase() === conn.label.toLowerCase());

    const agents = await this.agentRepo.find({
      where: { tenant_id: conn.tenant_id, deleted_at: IsNull() },
      select: { id: true, name: true },
    });
    if (agents.length === 0) return out;
    const agentIds = agents.map((a) => a.id);
    const [virtuals, tiers, specifics] = await Promise.all([
      this.virtualRepo.find({ where: { agent_id: In(agentIds) } }),
      this.tierRepo.find({ where: { agent_id: In(agentIds) } }),
      this.specificityRepo.find({ where: { agent_id: In(agentIds) } }),
    ]);

    const snapshots = new Map<string, Promise<RouteSnapshot>>();
    const snapshot = (agentId: string) => {
      let s = snapshots.get(agentId);
      if (!s) {
        s = this.routeStatus.snapshot(conn.tenant_id, agentId);
        snapshots.set(agentId, s);
      }
      return s;
    };
    const harness = new Map(agents.map((a) => [a.id, a.name]));

    const visit = async (
      row: ChainRow,
      chain: AffectedRoute['chain'],
      name: string,
      routable: (snap: RouteSnapshot) => Promise<boolean> | boolean,
    ) => {
      const entries: Array<[ModelRoute, string]> = [];
      const primary = readOverrideRoute(row);
      if (primary) entries.push([primary, 'primary']);
      (readFallbackRoutes(row) ?? []).forEach((r, i) => entries.push([r, `fallback ${i + 1}`]));
      const hits = entries.filter(([r]) => onConnection(r));
      if (hits.length === 0) return;
      const snap = await snapshot(row.agent_id);
      const chainRoutable = await routable(snap);
      for (const [route, position] of hits) {
        // The agent's catalog must agree: still listed elsewhere is no outage.
        const outOfService = routeOutOfServiceReason(route, snap) !== null;
        if (outOfService !== removed) continue;
        const list = out.get(route.model) ?? [];
        list.push({
          agent_id: row.agent_id,
          harness: harness.get(row.agent_id) ?? row.agent_id,
          chain,
          name,
          position,
          disabled: isRouteDisabled(route),
          chain_routable: chainRoutable,
        });
        out.set(route.model, list);
      }
    };

    const defaultTiers = new Map(
      tiers.filter((t) => t.tier === DEFAULT_TIER_SLOT).map((t) => [t.agent_id, t]),
    );
    const ownRoutable = (row: ChainRow) => (snap: RouteSnapshot) =>
      [readOverrideRoute(row), ...(readFallbackRoutes(row) ?? [])].some(
        (r) => r !== null && snapshotRouteState(r, snap).state !== 'unavailable',
      );

    // In order (virtual models, tiers, categories) so events read the same way each time.
    for (const vm of virtuals) {
      await visit(vm, 'virtual_model', vm.name, (snap) =>
        virtualModelRoutable(vm, defaultTiers.get(vm.agent_id) ?? null, snap),
      );
    }
    for (const t of tiers) await visit(t, 'tier', t.tier, ownRoutable(t));
    for (const c of specifics) await visit(c, 'specificity', c.category, ownRoutable(c));
    return out;
  }

  private emit(
    change: ModelCatalogChange,
    model: string,
    routes: AffectedRoute[],
    removed: boolean,
  ): void {
    const conn = change.connection;
    const where = `${conn.provider}${conn.label ? ` "${conn.label}"` : ''}`;
    const describe = (r: AffectedRoute) => {
      const kind =
        r.chain === 'virtual_model'
          ? `virtual model "${r.name}"`
          : r.chain === 'tier'
            ? `tier ${r.name}`
            : `category ${r.name}`;
      const flags = [
        r.disabled ? 'disabled' : null,
        removed && !r.chain_routable ? 'no route left' : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${r.harness}: ${kind} (${r.position}${flags ? `, ${flags}` : ''})`;
    };
    const harnesses = [...new Set(routes.map((r) => r.harness))];
    const stranded = routes.filter((r) => !r.chain_routable);
    const usedBy = routes.map(describe).join('; ');
    emitAlert({
      tenantId: conn.tenant_id,
      level: removed ? (stranded.length > 0 ? 'error' : 'warning') : 'info',
      type: removed ? 'route.out_of_service' : 'route.restored',
      title: removed
        ? `Route out of service: ${model} on ${where}`
        : `Route back in service: ${model} on ${where}`,
      message: removed
        ? `${where} no longer lists ${model}. Used by ${usedBy}. Those routes are skipped until the model comes back.`
        : `${where} lists ${model} again. Used by ${usedBy}. Active routes serve again; disabled ones stay disabled.`,
      entityType: 'model',
      entityId: model,
      entityName: model,
      metadata: {
        connection_id: conn.id,
        provider: conn.provider,
        label: conn.label,
        model,
        harnesses,
        routes,
      },
      vars: {
        'connection.id': conn.id,
        'connection.provider': conn.provider,
        'connection.label': conn.label ?? '',
        'route.model': model,
        'route.harnesses': harnesses.join(', '),
        'route.used_by': usedBy,
      },
    });
  }
}
