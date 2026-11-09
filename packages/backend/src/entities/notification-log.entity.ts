import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

export type LimitAlertType = 'soft' | 'hard';

@Entity('notification_logs')
// One soft alert and one block notice per rule and period (`both` sends both).
@Index('UQ_notification_logs_rule_type_period', ['rule_id', 'alert_type', 'period_start'], {
  unique: true,
})
export class NotificationLog {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  rule_id!: string;

  /** `soft` (limit.alert) or `hard` (limit.block). */
  @Column('varchar', { length: 8, default: 'soft' })
  alert_type!: LimitAlertType;

  @Column(timestampType())
  period_start!: string;

  @Column(timestampType())
  period_end!: string;

  @Column('decimal', { precision: 15, scale: 6 })
  actual_value!: number;

  @Column('decimal', { precision: 15, scale: 6 })
  threshold_value!: number;

  @Column('varchar')
  metric_type!: string;

  @Column('varchar')
  agent_name!: string;

  @Column(timestampType(), { default: timestampDefault() })
  sent_at!: string;
}
