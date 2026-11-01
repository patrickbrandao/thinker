import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

/**
 * Outbound proxy servers (see migration 1804700000000-AddProxyServers). The
 * service layer uses raw SQL; these entities keep `synchronize`-built schemas
 * (e2e) in line with the migration. The case-insensitive name index lives
 * only in the migration.
 */
@Entity('proxy_servers')
export class ProxyServer {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar', { length: 100 })
  name!: string;

  @Column('varchar', { length: 5, default: 'http' })
  scheme!: string;

  @Column('varchar', { length: 255 })
  host!: string;

  @Column('integer')
  port!: number;

  @Column('varchar', { length: 255, nullable: true })
  username!: string | null;

  @Column('varchar', { nullable: true })
  password_encrypted!: string | null;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @Column('integer', { default: 10000 })
  connect_timeout_ms!: number;

  @Column('boolean', { default: false })
  debug_enabled!: boolean;

  @Column(timestampType(), { nullable: true })
  debug_until!: string | null;

  @Column('integer', { nullable: true })
  log_retention_days!: number | null;

  @Column('varchar', { nullable: true })
  created_by_user_id!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}

@Entity('proxy_bindings')
@Index(['proxy_id'])
export class ProxyBinding {
  @PrimaryColumn('varchar')
  tenant_id!: string;

  @PrimaryColumn('varchar', { length: 20 })
  target_type!: string;

  @PrimaryColumn('varchar')
  target_id!: string;

  @PrimaryColumn('integer')
  position!: number;

  /** NULL is the "Direct" item. */
  @Column('varchar', { nullable: true })
  proxy_id!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @ManyToOne(() => ProxyServer, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'proxy_id' })
  proxy?: ProxyServer | null;
}

/** Named outbound chain; its items are `proxy_bindings` rows with `target_type = 'profile'`. */
@Entity('proxy_profiles')
export class ProxyProfile {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar', { length: 100 })
  name!: string;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}

/** How a provider default, connection, trigger or e-mail config leaves: global, direct or a profile. */
@Entity('proxy_assignments')
@Index(['profile_id'])
export class ProxyAssignment {
  @PrimaryColumn('varchar')
  tenant_id!: string;

  @PrimaryColumn('varchar', { length: 20 })
  target_type!: string;

  @PrimaryColumn('varchar')
  target_id!: string;

  @Column('varchar', { length: 10 })
  mode!: string;

  @Column('varchar', { nullable: true })
  profile_id!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;

  @ManyToOne(() => ProxyProfile, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'profile_id' })
  profile?: ProxyProfile | null;
}

@Entity('proxy_logs')
@Index(['tenant_id', 'proxy_id', 'started_at'])
@Index(['started_at'])
export class ProxyLog {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar', { nullable: true })
  proxy_id!: string | null;

  @Column('varchar', { length: 100 })
  proxy_name!: string;

  @Column(timestampType(), { default: timestampDefault() })
  started_at!: string;

  @Column('integer', { default: 0 })
  duration_ms!: number;

  @Column('integer', { nullable: true })
  tunnel_ms!: number | null;

  @Column('varchar', { length: 20 })
  source_type!: string;

  @Column('varchar', { nullable: true })
  source_id!: string | null;

  @Column('varchar', { nullable: true })
  source_label!: string | null;

  @Column('varchar')
  destination!: string;

  @Column('integer', { default: 1 })
  position!: number;

  @Column('varchar', { length: 32 })
  result!: string;

  @Column('integer', { nullable: true })
  status_code!: number | null;

  @Column('bigint', { default: 0 })
  bytes_sent!: string;

  @Column('bigint', { default: 0 })
  bytes_received!: string;

  @Column('varchar', { nullable: true })
  request_id!: string | null;

  @Column('varchar', { nullable: true })
  agent_message_id!: string | null;

  @Column('text', { nullable: true })
  error!: string | null;

  @ManyToOne(() => ProxyServer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'proxy_id' })
  proxy?: ProxyServer | null;
}

@Entity('proxy_usage_daily')
@Index(['tenant_id', 'day'])
export class ProxyUsageDaily {
  @PrimaryColumn('varchar')
  tenant_id!: string;

  @PrimaryColumn('varchar')
  proxy_id!: string;

  @PrimaryColumn('date')
  day!: string;

  @PrimaryColumn('varchar', { length: 20 })
  source_type!: string;

  @PrimaryColumn('varchar', { default: '' })
  source_id!: string;

  @Column('varchar', { length: 100 })
  proxy_name!: string;

  @Column('integer', { default: 0 })
  connections!: number;

  @Column('integer', { default: 0 })
  successes!: number;

  @Column('integer', { default: 0 })
  failures!: number;

  @Column('jsonb', { default: () => `'{}'::jsonb` })
  failures_by_code!: Record<string, number>;

  @Column('bigint', { default: 0 })
  tunnel_ms_sum!: string;

  @Column('integer', { default: 0 })
  tunnel_ms_max!: number;

  @Column('integer', { default: 0 })
  tunnel_samples!: number;

  @Column('bigint', { default: 0 })
  bytes_sent!: string;

  @Column('bigint', { default: 0 })
  bytes_received!: string;

  @Column('integer', { default: 0 })
  fallback_uses!: number;
}
