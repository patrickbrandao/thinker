import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, OneToOne, Index } from 'typeorm';
import { Tenant } from './tenant.entity';
import { AgentApiKey } from './agent-api-key.entity';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

/**
 * What `GET /v1/models` lists for the agent: `closed` only `auto` and the
 * virtual models, `restricted` also the real models their routes and
 * fallbacks reach, `open` every model in the catalog.
 */
export const MODEL_LISTING_MODES = ['closed', 'restricted', 'open'] as const;
export type ModelListingMode = (typeof MODEL_LISTING_MODES)[number];

@Entity('agents')
@Index(['tenant_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class Agent {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  name!: string;

  @Column('varchar', { nullable: true })
  display_name!: string | null;

  @Column('varchar', { nullable: true })
  description!: string | null;

  @Column('varchar', { nullable: true })
  agent_category!: string | null;

  @Column('varchar', { nullable: true })
  agent_platform!: string | null;

  @Column('boolean', { default: true })
  is_active!: boolean;

  @Column('boolean', { default: false })
  complexity_routing_enabled!: boolean;

  // Enabled for newly created agents. Existing agents keep their persisted
  // choice because the migration changes only the column default.
  @Column('boolean', { default: true })
  record_messages!: boolean;

  // Log retention in days for this harness; NULL follows the organization's.
  @Column('integer', { nullable: true, default: null })
  log_retention_days!: number | null;

  // Reserved Playground agent (the per-tenant "Playground" agent). Hidden
  // from the agent list / switcher / counts and not user-creatable/renamable.
  @Column('boolean', { default: false })
  is_playground!: boolean;

  @Column('varchar', { default: 'open' })
  model_listing!: ModelListingMode;

  @ManyToOne(() => Tenant, (t) => t.agents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column('varchar')
  tenant_id!: string;

  @OneToOne(() => AgentApiKey, (k) => k.agent, { cascade: true })
  apiKey!: AgentApiKey;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;

  @Column(timestampType(), { nullable: true, default: null })
  deleted_at!: string | null;
}
