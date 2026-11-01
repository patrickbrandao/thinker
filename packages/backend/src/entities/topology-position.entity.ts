import { Entity, Column, PrimaryColumn } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

/** Where the user dropped a node of the topology canvas (per workspace). */
@Entity('topology_positions')
export class TopologyPosition {
  @PrimaryColumn('varchar')
  tenant_id!: string;

  @PrimaryColumn('varchar', { length: 300 })
  node_id!: string;

  @Column('integer')
  x!: number;

  @Column('integer')
  y!: number;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}
