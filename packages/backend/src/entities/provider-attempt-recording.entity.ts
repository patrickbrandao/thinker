import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * A Provider Attempt recording stored in PostgreSQL (ADR 0013). Written and read
 * with raw SQL by RequestRecordingStorageService; the entity keeps the schema
 * in step with migration AddProviderAttemptRecordings1806200000000.
 */
@Entity('provider_attempt_recordings')
@Index('IDX_provider_attempt_recordings_attempt', ['attempt_id'])
export class ProviderAttemptRecording {
  @PrimaryColumn('varchar', { primaryKeyConstraintName: 'PK_provider_attempt_recordings' })
  storage_key!: string;

  @Column('varchar')
  tenant_id!: string;

  @Column('varchar')
  request_id!: string;

  @Column('varchar')
  attempt_id!: string;

  @Column('jsonb')
  payload!: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
