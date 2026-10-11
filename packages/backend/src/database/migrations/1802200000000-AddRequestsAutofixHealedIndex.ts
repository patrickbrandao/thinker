import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Upstream built a cloud-only partial index here, over the requests Autofix
 * repaired, for Manifest Cloud's CRM metrics feed.
 *
 * Thinker has neither the feed (#15) nor Autofix (#16). On the self-hosted path
 * this migration never changed the schema, so `up()` is now that path on every
 * install: the minimal edit that drops the deployment-mode branch and keeps the
 * self-hosted SQL. The class name and timestamp stay, so databases that already
 * recorded it are unaffected. 1803300000000 and 1803400000000 drop the index
 * where an earlier cloud-mode run left it behind.
 *
 * `down()` still drops the index (a no-op where it never existed).
 * `npm run migration:revert` passes `--transaction none`, so it runs outside a
 * transaction as CONCURRENTLY requires.
 */
export class AddRequestsAutofixHealedIndex1802200000000 implements MigrationInterface {
  name = 'AddRequestsAutofixHealedIndex1802200000000';
  transaction = false;

  private static readonly INDEX = 'IDX_requests_autofix_healed';

  public async up(): Promise<void> {
    // Intentionally empty: the self-hosted path made no schema change.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${AddRequestsAutofixHealedIndex1802200000000.INDEX}"`,
    );
  }
}
