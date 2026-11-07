import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * THINKER_PROVIDER_PRIVATE_URLS used to be checked only when a URL was saved;
 * every later request accepted private and LAN addresses, so a hostname that
 * was public at registration could be pointed at the internal network
 * afterwards (DNS rebinding). `allow_private_destination` records what the
 * policy allowed whoever saved the URL, and connections refuse private
 * addresses when it is false (ADR 0006 item 7).
 *
 * Existing rows default to true: providers already registered keep working,
 * as ADR 0006 promises when the policy changes.
 */
export class AllowPrivateDestination1805900000000 implements MigrationInterface {
  name = 'AllowPrivateDestination1805900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_providers" ADD COLUMN IF NOT EXISTS "allow_private_destination" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "allow_private_destination" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" DROP COLUMN IF EXISTS "allow_private_destination"`,
    );
    await queryRunner.query(
      `ALTER TABLE "custom_providers" DROP COLUMN IF EXISTS "allow_private_destination"`,
    );
  }
}
