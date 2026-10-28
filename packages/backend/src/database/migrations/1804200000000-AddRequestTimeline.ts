import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-Request timeline: timestamped events from the caller's first HTTP
 * contact through each provider call to the last byte sent back. Nullable with
 * no default, so the ADD COLUMN is a metadata change and old rows stay NULL.
 */
export class AddRequestTimeline1804200000000 implements MigrationInterface {
  name = 'AddRequestTimeline1804200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "timeline" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "timeline"`);
  }
}
