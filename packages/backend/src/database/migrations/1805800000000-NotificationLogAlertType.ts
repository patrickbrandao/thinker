import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A limit rule with action `both` sends two signals per period: the soft
 * alert (`limit.alert`, from the cron) and the block notice (`limit.block`,
 * from the request path). They used to share one dedupe row per
 * (rule, period), so whichever came first silenced the other. `alert_type`
 * splits them; existing rows are soft alerts or block notices that both
 * paths treated alike, so they default to `soft`.
 */
export class NotificationLogAlertType1805800000000 implements MigrationInterface {
  name = 'NotificationLogAlertType1805800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_logs" ADD COLUMN IF NOT EXISTS "alert_type" varchar(8) NOT NULL DEFAULT 'soft'`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_951323f7afddb097bfbda22542"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_logs_rule_type_period"
         ON "notification_logs" ("rule_id", "alert_type", "period_start")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_notification_logs_rule_type_period"`);
    await queryRunner.query(
      `DELETE FROM "notification_logs" WHERE "alert_type" = 'hard'
         AND ("rule_id", "period_start") IN (
           SELECT "rule_id", "period_start" FROM "notification_logs" WHERE "alert_type" = 'soft')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_951323f7afddb097bfbda22542"
         ON "notification_logs" ("rule_id", "period_start")`,
    );
    await queryRunner.query(`ALTER TABLE "notification_logs" DROP COLUMN IF EXISTS "alert_type"`);
  }
}
