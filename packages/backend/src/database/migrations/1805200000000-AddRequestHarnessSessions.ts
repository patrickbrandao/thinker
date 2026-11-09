import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Harness sessions: `requests.session_id` (until now unused) holds the
 * session the harness named in its headers and `parent_session_id` the
 * session that spawned it (OpenCode subagents). Existing rows are filled from
 * the headers already recorded, with the header order of harness-session.ts.
 */
export class AddRequestHarnessSessions1805200000000 implements MigrationInterface {
  name = 'AddRequestHarnessSessions1805200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "parent_session_id" varchar`,
    );

    const h = (name: string) => `NULLIF(NULLIF(btrim(hdr->>'${name}'), ''), 'default')`;
    await queryRunner.query(`
      WITH parsed AS (
        SELECT id, request_headers::jsonb AS hdr
          FROM requests
         WHERE session_id IS NULL
           AND request_headers IS NOT NULL
           AND pg_input_is_valid(request_headers, 'jsonb')
      ), detected AS (
        SELECT id,
               left(COALESCE(
                 ${h('x-session-key')}, ${h('x-openclaw-session-key')},
                 ${h('x-claude-code-session-id')}, ${h('x-opencode-session-id')},
                 ${h('x-opencode-session')}, ${h('x-hermes-session-id')},
                 ${h('x-hermes-session-key')}, ${h('session_id')}, ${h('conversation_id')},
                 ${h('x-session-id')}, ${h('x-session-affinity')},
                 CASE WHEN hdr ? 'originator' THEN ${h('x-client-request-id')} END
               ), 200) AS sid,
               left(COALESCE(${h('x-opencode-parent-session-id')}, ${h('x-parent-session-id')}), 200)
                 AS parent
          FROM parsed
      )
      UPDATE requests r
         SET session_id = d.sid,
             parent_session_id = NULLIF(d.parent, d.sid)
        FROM detected d
       WHERE r.id = d.id AND d.sid IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_requests_tenant_session"
        ON "requests" ("tenant_id", "session_id", "timestamp")
        WHERE "session_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_requests_tenant_parent_session"
        ON "requests" ("tenant_id", "parent_session_id")
        WHERE "parent_session_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_requests_tenant_parent_session"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_requests_tenant_session"`);
    await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "parent_session_id"`);
    await queryRunner.query(`UPDATE "requests" SET "session_id" = NULL`);
  }
}
