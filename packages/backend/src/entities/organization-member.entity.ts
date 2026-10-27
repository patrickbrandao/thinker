import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Tenant } from './tenant.entity';
import { timestampDefault, timestampType } from '../common/utils/postgres-sql';

export const ORGANIZATION_ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** A user's membership and role in an organization (a tenant), ADR 0006. */
@Entity('organization_members')
export class OrganizationMember {
  @PrimaryColumn('varchar')
  tenant_id!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @PrimaryColumn('varchar')
  user_id!: string;

  @Column('varchar')
  role!: OrganizationRole;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;
}
