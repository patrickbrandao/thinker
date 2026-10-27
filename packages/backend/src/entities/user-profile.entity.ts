import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Thinker-side account flags for a Better Auth user (ADR 0006). */
@Entity('user_profiles')
export class UserProfile {
  @PrimaryColumn('varchar')
  user_id!: string;

  @Column('boolean', { default: false })
  is_instance_admin!: boolean;

  @Column('boolean', { default: false })
  must_change_password!: boolean;

  @Column('varchar', { nullable: true })
  active_tenant_id!: string | null;
}
