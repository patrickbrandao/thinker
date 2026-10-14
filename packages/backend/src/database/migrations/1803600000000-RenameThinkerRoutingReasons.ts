import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the `routing_reason` values the proxy stamps on its own blocked
 * requests from the inherited `manifest_*` prefix to `thinker_*`
 * (`thinker_rate_limited`, `thinker_ip_rate_limited`,
 * `thinker_concurrency_limited`, `thinker_invalid_request`,
 * `thinker_internal_error`). The code only writes and reads the new values.
 *
 * Only rows with the old prefix are touched, so the update is idempotent.
 * `down()` restores the old prefix on the same five values.
 */
const RENAMED = [
  'rate_limited',
  'ip_rate_limited',
  'concurrency_limited',
  'invalid_request',
  'internal_error',
] as const;

const OLD_PREFIX = ['manifest', ''].join('_');
const NEW_PREFIX = 'thinker_';

function renameSql(from: string, to: string): string {
  const cases = RENAMED.map((r) => `WHEN '${from}${r}' THEN '${to}${r}'`).join(' ');
  const list = RENAMED.map((r) => `'${from}${r}'`).join(', ');
  return `UPDATE "agent_messages" SET "routing_reason" = CASE "routing_reason" ${cases} END WHERE "routing_reason" IN (${list})`;
}

export class RenameThinkerRoutingReasons1803600000000 implements MigrationInterface {
  name = 'RenameThinkerRoutingReasons1803600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(renameSql(OLD_PREFIX, NEW_PREFIX));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(renameSql(NEW_PREFIX, OLD_PREFIX));
  }
}
