import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';
import { Agent } from './agent.entity';

/**
 * Event triggers (see migration 1804400000000-AddEventTriggers). The service
 * layer uses raw SQL; these entities keep `synchronize`-built schemas (e2e)
 * in line with the migration. The case-insensitive name index lives only in
 * the migration.
 */
@Entity('triggers')
export class Trigger {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar', { length: 100 })
  name!: string;

  @Column('varchar')
  type!: string;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @Column('jsonb', { default: () => `'{}'::jsonb` })
  config!: Record<string, unknown>;

  @Column('varchar', { nullable: true })
  secrets_encrypted!: string | null;

  @Column('integer', { default: 3 })
  max_retries!: number;

  @Column('integer', { default: 30 })
  retry_delay_seconds!: number;

  @Column('integer', { default: 10 })
  timeout_seconds!: number;

  @Column('jsonb', { default: () => `'[]'::jsonb` })
  workspace_events!: string[];

  @Column('varchar', { nullable: true })
  created_by_user_id!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}

@Entity('agent_triggers')
@Index(['trigger_id'])
export class AgentTrigger {
  @PrimaryColumn('varchar')
  agent_id!: string;

  @PrimaryColumn('varchar')
  trigger_id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('jsonb', { default: () => `'[]'::jsonb` })
  events!: string[];

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent?: Agent;

  @ManyToOne(() => Trigger, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trigger_id' })
  trigger?: Trigger;
}

@Entity('trigger_events')
@Index(['trigger_id', 'status'])
@Index(['tenant_id', 'created_at'])
export class TriggerEvent {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar', { nullable: true })
  trigger_id!: string | null;

  @Column('varchar')
  trigger_name!: string;

  @Column('varchar')
  trigger_type!: string;

  @Column('varchar', { nullable: true })
  agent_id!: string | null;

  @Column('varchar', { nullable: true })
  agent_name!: string | null;

  @Column('varchar')
  event_type!: string;

  @Column('jsonb', { default: () => `'{}'::jsonb` })
  payload!: Record<string, string>;

  @Column('varchar', { default: 'pending' })
  status!: string;

  @Column('integer', { default: 0 })
  attempts!: number;

  @Column(timestampType(), { nullable: true, default: timestampDefault() })
  next_attempt_at!: string | null;

  @Column('text', { nullable: true })
  last_error!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;

  @Column(timestampType(), { nullable: true })
  delivered_at!: string | null;

  @ManyToOne(() => Trigger, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'trigger_id' })
  trigger?: Trigger | null;
}

@Entity('trigger_event_logs')
@Index(['event_id', 'attempt'])
export class TriggerEventLog {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  event_id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('integer')
  attempt!: number;

  @Column(timestampType(), { default: timestampDefault() })
  started_at!: string;

  @Column('integer', { default: 0 })
  duration_ms!: number;

  @Column('boolean')
  success!: boolean;

  @Column('integer', { nullable: true })
  status_code!: number | null;

  @Column('text', { nullable: true })
  error!: string | null;

  @Column('text', { nullable: true })
  response!: string | null;

  @ManyToOne(() => TriggerEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event?: TriggerEvent;
}
