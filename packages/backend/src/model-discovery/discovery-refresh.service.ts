import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Subscription } from 'rxjs';
import { TenantProvider } from '../entities/tenant-provider.entity';
import {
  TriggerSignalService,
  type TriggerSignal,
} from '../common/services/trigger-signal.service';
import { isModelUnavailable } from '../triggers/trigger-listener.service';
import { ModelDiscoveryService } from './model-discovery.service';

/** Default hours between two periodic rediscoveries of every connection. */
export const DEFAULT_DISCOVERY_INTERVAL_HOURS = 6;
/** Minimum time between two rediscoveries of one connection after a model error. */
export const MODEL_ERROR_REDISCOVERY_COOLDOWN_MS = 5 * 60_000;
const MAX_TRACKED = 5_000;

/** `THINKER_DISCOVERY_INTERVAL_HOURS`: hours between rounds, 0 turns them off. */
export function discoveryIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.THINKER_DISCOVERY_INTERVAL_HOURS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DISCOVERY_INTERVAL_HOURS * 3_600_000;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.max(hours, 0.25) * 3_600_000;
}

type AttemptSignal = Extract<TriggerSignal, { kind: 'attempt' }>;

/**
 * Keeps each connection's model list current so routes go out of and back
 * into service without a manual refresh:
 * - every THINKER_DISCOVERY_INTERVAL_HOURS (default 6, 0 off) every active
 *   connection is rediscovered, one at a time;
 * - when a provider says a model does not exist (the `model.error`
 *   heuristic), that connection alone is rediscovered in the background, at
 *   most once per MODEL_ERROR_REDISCOVERY_COOLDOWN_MS.
 * Both are provider traffic to configured connections, never phone-home. The
 * manual refresh stays as it is.
 */
@Injectable()
export class DiscoveryRefreshService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryRefreshService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private subscription: Subscription | null = null;
  private running = false;
  /** Connection id → last rediscovery triggered by a model error. */
  private readonly lastReaction = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(TenantProvider)
    private readonly providerRepo: Repository<TenantProvider>,
    private readonly discovery: ModelDiscoveryService,
    @Optional() private readonly signals?: TriggerSignalService,
  ) {}

  /** Clock, overridable in tests. */
  protected now(): number {
    return Date.now();
  }

  onApplicationBootstrap(): void {
    const interval = discoveryIntervalMs();
    if (interval > 0) {
      this.timer = setInterval(() => void this.refreshAll(), interval);
      this.timer.unref?.();
    }
    this.subscription =
      this.signals?.signals().subscribe((signal) => {
        if (signal.kind === 'attempt') void this.onAttempt(signal);
      }) ?? null;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.subscription?.unsubscribe();
  }

  /** One periodic round over every active connection. Never overlaps itself. */
  async refreshAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const providers = await this.providerRepo.find({ where: { is_active: true } });
      for (const provider of providers) {
        if (provider.provider.startsWith('custom:')) continue;
        await this.discovery.discoverModels(provider).catch((err) => {
          this.logger.warn(`Periodic discovery failed for ${provider.provider}: ${String(err)}`);
        });
      }
    } catch (err) {
      this.logger.warn(`Periodic discovery round failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Rediscovers the connection of a failed attempt the provider blamed on the model. */
  async onAttempt(signal: AttemptSignal): Promise<void> {
    if (signal.ok || !signal.tenantProviderId) return;
    if (signal.errorCode || signal.errorOrigin === 'thinker') return;
    if (!isModelUnavailable(signal.httpStatus, signal.errorMessage, signal.model ?? null)) return;
    const id = signal.tenantProviderId;
    const now = this.now();
    const last = this.lastReaction.get(id);
    if (
      this.inFlight.has(id) ||
      (last !== undefined && now - last < MODEL_ERROR_REDISCOVERY_COOLDOWN_MS)
    ) {
      return;
    }
    this.lastReaction.set(id, now);
    if (this.lastReaction.size > MAX_TRACKED) this.lastReaction.clear();
    this.inFlight.add(id);
    try {
      const provider = await this.providerRepo.findOne({
        where: { id, tenant_id: signal.tenantId, is_active: true },
      });
      if (!provider || provider.provider.startsWith('custom:')) return;
      this.logger.log(
        `${provider.provider} reported ${signal.model ?? 'a model'} unavailable; rediscovering its models`,
      );
      await this.discovery.discoverModels(provider);
    } catch (err) {
      this.logger.warn(`Rediscovery after a model error failed: ${String(err)}`);
    } finally {
      this.inFlight.delete(id);
    }
  }
}
