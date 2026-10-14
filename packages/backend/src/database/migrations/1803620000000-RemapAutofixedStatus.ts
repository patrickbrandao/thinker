import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remaps `agent_messages.status = 'auto_fixed'` (#68). Upstream's Autofix
 * recorded a healed request as two rows: the failed original (`auto_fixed`)
 * and the successful retry (`ok`). Since #16 removed Autofix, no reader knows
 * `auto_fixed`: those rows dropped out of both the error and the superseded
 * counts.
 *
 * The original was a failed attempt that a later attempt recovered, which is
 * exactly what `fallback_error` with `superseded = true` means today. Both
 * lists counted `auto_fixed` before #16 (`ERROR_MESSAGE_STATUSES` and
 * `SUPERSEDED_STATUSES`), and both count `fallback_error` now, so the history
 * reads as it did. The paired retry row stays a success.
 *
 * Idempotent: a re-run finds no `auto_fixed` row. `lock_timeout` makes it fail
 * fast instead of queueing behind a long query; a failed run retries on the
 * next boot. `down()` is a no-op: the remapped rows cannot be told apart from
 * real fallback errors, and nothing reads `auto_fixed` any more.
 */
export class RemapAutofixedStatus1803620000000 implements MigrationInterface {
  name = 'RemapAutofixedStatus1803620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `UPDATE "agent_messages" SET "status" = 'fallback_error', "superseded" = true WHERE "status" = 'auto_fixed'`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally empty: see the class comment.
  }
}
