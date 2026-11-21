import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Triggers follow THINKER_PROVIDER_PRIVATE_URLS like provider URLs do (ADR 0006
 * item 7). Syslog, RELP and GELF destinations used to skip the policy, and a
 * webhook was checked only when saved. `allow_private_destination` records
 * what the policy allowed whoever saved the trigger; deliveries refuse
 * private, LAN and loopback addresses when it is false, also after a DNS
 * change.
 *
 * Existing triggers default to true, so destinations already in use keep
 * working, as ADR 0006 promises when the policy changes.
 */
export class TriggerAllowPrivateDestination1806400000000 implements MigrationInterface {
  name = 'TriggerAllowPrivateDestination1806400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "triggers" ADD COLUMN IF NOT EXISTS "allow_private_destination" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "triggers" DROP COLUMN IF EXISTS "allow_private_destination"`,
    );
  }
}
