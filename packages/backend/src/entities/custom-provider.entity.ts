import { Entity, Column, PrimaryColumn } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';
import type { LocalServerConfig, LocalServerType } from '../common/constants/local-servers';

/** What a local server reports a model can do (Ollama `/api/show`, LM Studio `/api/v1/models`). */
export type LocalModelCapability = 'tools' | 'vision' | 'reasoning';

export interface CustomProviderModel {
  model_name: string;
  input_price_per_million_tokens?: number;
  output_price_per_million_tokens?: number;
  context_window?: number;
  price_estimated?: boolean;
  /** Local servers only: capabilities reported by the server at probe time. */
  capabilities?: LocalModelCapability[];
}

export type CustomProviderApiKind = 'openai' | 'anthropic';

// Uniqueness is owned by the migration as a case-insensitive index on
// (tenant_id, LOWER(name)) — which a column-list @Index can't express. Declaring a
// case-sensitive @Index here would drift from the real schema (synchronize ≠
// migrations), so it's intentionally omitted (same pattern as tenant_providers).
@Entity('custom_providers')
export class CustomProvider {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  /** Audit-only: which user created the provider. Never used for scoping. */
  @Column('varchar', { nullable: true })
  created_by_user_id!: string | null;

  @Column('varchar')
  name!: string;

  /**
   * Public prefix of this provider's model ids in `/v1/models`
   * (`<alias>/<model_name>`). Null means the models publish under the
   * internal `custom:<uuid>/<model_name>` key. Uniqueness is a
   * case-insensitive partial index on (tenant_id, LOWER(alias)) owned by
   * the migration, same as `name`.
   */
  @Column('varchar', { nullable: true })
  alias!: string | null;

  @Column('varchar')
  base_url!: string;

  @Column('varchar', { default: 'openai' })
  api_kind!: CustomProviderApiKind;

  /**
   * Set when the row is a local server (Ollama, LM Studio, llama.cpp). Such
   * rows sit under the Local tab, are never billed, and keep `base_url`
   * derived from `local_config`.
   */
  @Column('varchar', { nullable: true, default: null })
  local_type!: LocalServerType | null;

  @Column('jsonb', { nullable: true, default: null })
  local_config!: LocalServerConfig | null;

  @Column('simple-json')
  models!: CustomProviderModel[];

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;
}
