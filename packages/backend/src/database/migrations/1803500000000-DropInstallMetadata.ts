import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `install_metadata` (#17). The table only held the anonymous install id
 * and send schedule of the removed usage telemetry (1775700000000); its last
 * other column, the Autofix consent stamp, already left in 1803400000000.
 * Nothing in Thinker reads or writes it, and the id it holds identified this
 * install to Manifest's telemetry ingest, so it is not worth keeping.
 *
 * `IF EXISTS` keeps the drop idempotent. `lock_timeout` makes it fail fast
 * instead of queueing behind a long-running query; a failed run is retried on
 * the next boot.
 *
 * `down()` recreates the table as 1775700000000 created it, empty, so that
 * reverting 1803400000000 next can restore its column. The old install id is
 * not restored: it is never used again. Like the other drops, `down()` sets no
 * `SET LOCAL`: `migration:revert` runs with `--transaction none`.
 */
export class DropInstallMetadata1803500000000 implements MigrationInterface {
  name = 'DropInstallMetadata1803500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`DROP TABLE IF EXISTS "install_metadata"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "install_metadata" (
        "id" varchar NOT NULL,
        "install_id" varchar NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "first_send_at" timestamp DEFAULT NULL,
        "last_sent_at" timestamp DEFAULT NULL,
        CONSTRAINT "PK_install_metadata" PRIMARY KEY ("id")
      )`,
    );
  }
}
