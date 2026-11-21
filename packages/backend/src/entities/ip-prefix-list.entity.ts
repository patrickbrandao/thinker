import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

/** One address or prefix of a list: `203.0.113.7/32`, `2001:db8::/48`. */
export interface IpPrefixEntry {
  prefix: string;
  label?: string | null;
}

/**
 * Named IPv4/IPv6 prefix list (migration 1806100000000-HarnessKeysAndIpPrefixes).
 * The service layer uses raw SQL; these entities keep `synchronize`-built
 * schemas (e2e) in line with the migration. The case-insensitive name index
 * lives only in the migration.
 */
@Entity('ip_prefix_lists')
export class IpPrefixList {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar', { length: 100 })
  name!: string;

  @Column('varchar', { length: 500, nullable: true })
  description!: string | null;

  @Column('jsonb', { default: () => `'[]'::jsonb` })
  entries!: IpPrefixEntry[];

  @Column('varchar', { nullable: true })
  created_by_user_id!: string | null;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}

/** Lists an API key is accepted from when `agent_api_keys.ip_restriction_enabled` is on. */
@Entity('agent_api_key_ip_prefix_lists')
@Index(['list_id'])
export class AgentApiKeyIpPrefixList {
  @PrimaryColumn('varchar')
  key_id!: string;

  @PrimaryColumn('varchar')
  list_id!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;
}
