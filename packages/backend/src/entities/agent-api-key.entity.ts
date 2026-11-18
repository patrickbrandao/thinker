import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Tenant } from './tenant.entity';
import { Agent } from './agent.entity';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

@Entity('agent_api_keys')
@Index('IDX_agent_api_keys_agent', ['agent_id'])
@Index('IDX_agent_api_keys_primary', ['agent_id'], { unique: true, where: '"is_primary"' })
export class AgentApiKey {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { length: 255, nullable: true })
  key!: string | null;

  @Index({ unique: true })
  @Column('varchar', { length: 128 })
  key_hash!: string;

  @Column('varchar', { length: 12 })
  key_prefix!: string;

  @Column('varchar', { nullable: true })
  label!: string | null;

  /** Name given in the dashboard; null on keys created before many keys per harness. */
  @Column('varchar', { length: 100, nullable: true })
  name!: string | null;

  /**
   * The harness's original key: never expires unless it already did, stays
   * recoverable (`key` holds it encrypted) and is replaced by rotation. At most
   * one per harness. Extra keys are shown once and never stored readable.
   */
  @Column('boolean', { default: false })
  is_primary!: boolean;

  /** Set when the key is revoked (it then also has `is_active = false`), never cleared. */
  @Column(timestampType(), { nullable: true })
  revoked_at!: string | null;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column('varchar')
  tenant_id!: string;

  @ManyToOne(() => Agent, (a) => a.apiKeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent;

  @Column('varchar')
  agent_id!: string;

  @Column('boolean', { default: true })
  is_active!: boolean;

  @Column(timestampType(), { nullable: true })
  expires_at!: string | null;

  @Column(timestampType(), { nullable: true })
  last_used_at!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;
}
