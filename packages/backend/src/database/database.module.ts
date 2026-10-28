import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { pinSessionTimeZoneToUtc } from '../common/utils/utc-clock';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { entities, INVALID_WHERE_VALUES_BEHAVIOR, migrations } from './data-source-definitions';
// Entities referenced directly below via TypeOrmModule.forFeature(); the full
// registry for the DataSource lives in ./data-source-definitions.
import { Tenant } from '../entities/tenant.entity';
import { Agent } from '../entities/agent.entity';
import { AgentApiKey } from '../entities/agent-api-key.entity';
import { AgentMessage } from '../entities/agent-message.entity';
import { ThinkerRequest } from '../entities/request.entity';
import { ApiKey } from '../entities/api-key.entity';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { TierAssignment } from '../entities/tier-assignment.entity';
import { CustomProvider } from '../entities/custom-provider.entity';
import { SpecificityAssignment } from '../entities/specificity-assignment.entity';
import { VirtualModel } from '../entities/virtual-model.entity';
import { AgentModelParams } from '../entities/agent-model-params.entity';
import { ReasoningContentCacheEntry } from '../entities/reasoning-content-cache-entry.entity';
import { AgentEnabledProvider } from '../entities/agent-enabled-provider.entity';
import { DatabaseSeederService } from './database-seeder.service';
import { DbTuningService } from './db-tuning.service';
import { ModelPricesModule } from '../model-prices/model-prices.module';
import { shouldRetryDbConnection } from '../common/utils/db-retry';
import { RequestRecordingRetentionService } from './request-recording-retention.service';
import { SecretReencryptionService } from './secret-reencryption.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('app.databaseUrl'),
        entities,
        synchronize: false,
        // TypeORM 1.x default, spelled out so nobody flips it: a null/undefined
        // value in a high-level `where` throws instead of being dropped from the
        // filter (0.3 silently matched every row — a tenant-isolation hazard).
        // Match NULL with IsNull(). Never set this to 'ignore'.
        invalidWhereValuesBehavior: INVALID_WHERE_VALUES_BEHAVIOR,
        // Run migrations on boot by default. `synchronize: false` is permanent,
        // so committed migrations are the only source of schema changes, and a
        // single instance (dev, self-hosted) must boot with the schema applied
        // (the dashboard 500s on missing tables). On multi-replica deploys this
        // is turned off (RUN_MIGRATIONS_ON_BOOT=false) so replicas don't migrate
        // concurrently over PgBouncer — a pre-deploy step migrates once over a
        // direct connection instead. Previously this was hardcoded true, which
        // deadlocked when several replicas migrated at once on the same deploy.
        migrationsRun: config.get<boolean>('app.runMigrationsOnBoot'),
        // 'each' (per-migration transaction), not 'all': the agent_messages index
        // migrations run CONCURRENTLY and declare `transaction = false`, which
        // TypeORM forbids under 'all'. CONCURRENTLY avoids the ACCESS EXCLUSIVE
        // lock that deadlocks against live writes during a deploy.
        migrationsTransactionMode: 'each' as const,
        migrations,
        // A failed migration must not go through the connection-retry loop:
        // @nestjs/typeorm checks toRetry before logging, so returning false
        // here suppresses the misleading "Unable to connect to the database.
        // Retrying" line and fails fast with the real migration error. Genuine
        // connectivity failures (DB not ready yet) still retry.
        toRetry: shouldRetryDbConnection,
        logging: false,
        extra: {
          // app.config.ts always resolves dbPoolMax (default 10), so there is no
          // undefined case to fall back from — keep that file the single source
          // of truth for the pool size.
          max: config.get<number>('app.dbPoolMax'),
          idleTimeoutMillis: 30000,
          // Every session in UTC, like the process (#58): NOW() and
          // CURRENT_TIMESTAMP then agree with the timestamps Node writes.
          onConnect: pinSessionTimeZoneToUtc,
          // statement_timeout / idle_in_transaction_session_timeout were tried
          // here (#1745) and via the `options` connection string (#1749), but
          // Railway's PgBouncer rejects both forms — its
          // `ignore_startup_parameters` allowlist only includes
          // `extra_float_digits`. If we need per-query timeouts later, set
          // them with `SET LOCAL` inside the relevant transaction instead.
        },
      }),
    }),
    TypeOrmModule.forFeature([
      Tenant,
      Agent,
      AgentApiKey,
      AgentMessage,
      ThinkerRequest,
      ApiKey,
      TenantProvider,
      TierAssignment,
      CustomProvider,
      SpecificityAssignment,
      VirtualModel,
      AgentModelParams,
      ReasoningContentCacheEntry,
      AgentEnabledProvider,
    ]),
    ModelPricesModule,
  ],
  providers: [
    DatabaseSeederService,
    DbTuningService,
    RequestRecordingRetentionService,
    SecretReencryptionService,
  ],
  exports: [DatabaseSeederService],
})
export class DatabaseModule {}
