import { Entity, Column, PrimaryColumn } from 'typeorm';
import type { AuthType } from 'thinker-shared';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';
import type { DiscoveredModel } from '../model-discovery/model-fetcher';

@Entity('tenant_providers')
export class TenantProvider {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  /** Audit-only: which user connected the provider. Never used for scoping. */
  @Column('varchar', { nullable: true, default: null })
  created_by_user_id!: string | null;

  @Column('varchar', { nullable: true, default: null })
  agent_id!: string | null;

  @Column('varchar')
  provider!: string;

  @Column('varchar', { nullable: true, default: null })
  api_key_encrypted!: string | null;

  @Column('varchar', { nullable: true, default: null })
  key_prefix!: string | null;

  @Column('varchar', { default: 'api_key' })
  auth_type!: AuthType;

  @Column('varchar', { default: 'Default' })
  label!: string;

  @Column('integer', { default: 0 })
  priority!: number;

  @Column('varchar', { nullable: true, default: null })
  region!: string | null;

  /** API-key connections only: replaces the provider's base URL (null = official). */
  @Column('varchar', { nullable: true, default: null })
  base_url!: string | null;

  /**
   * Whether `base_url` may reach private/LAN addresses at connect time: what
   * THINKER_PROVIDER_PRIVATE_URLS allowed whoever set it (ADR 0006 item 7).
   */
  @Column('boolean', { default: true })
  allow_private_destination!: boolean;

  @Column('boolean', { default: true })
  is_active!: boolean;

  /** Stream warm-up override in ms (#244). Null inherits the local/global default. */
  @Column('integer', { nullable: true, default: null })
  stream_warmup_ms!: number | null;

  /**
   * Stream idle timeout override in ms: the longest gap between two upstream
   * chunks. Null inherits the local server's request timeout, then
   * STREAM_IDLE_TIMEOUT_MS.
   */
  @Column('integer', { nullable: true, default: null })
  stream_idle_timeout_ms!: number | null;

  @Column(timestampType(), { default: timestampDefault() })
  connected_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;

  @Column('simple-json', { nullable: true, default: null })
  cached_models!: DiscoveredModel[] | null;

  @Column(timestampType(), { nullable: true, default: null })
  models_fetched_at!: string | null;
}
