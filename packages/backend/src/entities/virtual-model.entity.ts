import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';
import type { ModelRoute, OutputModality, ResponseMode } from 'thinker-shared';

/**
 * A public model name an operator creates on a harness (ADR 0004). Requests
 * whose `model` matches the name route through this row's chain.
 */
@Entity('virtual_models')
@Index(['agent_id', 'sort_order'])
// The unique (agent_id, LOWER(name)) index and the agents(id) ON DELETE
// CASCADE foreign key are declared in the AddVirtualModels migration. Don't re-declare the index here with a case-sensitive
// collation: schema sync would drop the migration's index in dev.
export class VirtualModel {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar')
  agent_id!: string;

  @Column('varchar', { length: 64 })
  name!: string;

  @Column('integer', { default: 0 })
  sort_order!: number;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @Column('jsonb', { nullable: true })
  override_route!: ModelRoute | null;

  @Column('jsonb', { nullable: true })
  fallback_routes!: ModelRoute[] | null;

  @Column('boolean', { default: false })
  continue_on_default!: boolean;

  @Column('varchar', { default: 'buffered' })
  response_mode!: ResponseMode;

  @Column('varchar', { default: 'text' })
  output_modality!: OutputModality;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}
