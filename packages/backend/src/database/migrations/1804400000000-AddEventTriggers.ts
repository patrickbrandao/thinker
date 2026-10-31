import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  decryptWithAny,
  encrypt,
  getDecryptionSecrets,
  getEncryptionSecret,
  isEncrypted,
} from '../../common/utils/crypto.util';

/**
 * Event triggers: workspace-scoped delivery targets (e-mail, webhook,
 * Telegram, syslog) that harnesses bind to per event.
 *
 * - `triggers`: the registry. Non-secret settings in `config`, secrets as one
 *   encrypted JSON object in `secrets_encrypted`.
 * - `agent_triggers`: harness → trigger bindings with the subscribed events.
 * - `trigger_events`: the delivery queue, one row per (event, trigger), with
 *   the template variables frozen at emit time.
 * - `trigger_event_logs`: one row per delivery attempt.
 *
 * Each existing `email_provider_configs` row becomes an e-mail trigger bound
 * to every live harness that has limit rules, so alerts keep flowing. The old
 * table is left in place, unused.
 */
export class AddEventTriggers1804400000000 implements MigrationInterface {
  name = 'AddEventTriggers1804400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "triggers" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "name" varchar(100) NOT NULL,
        "type" varchar NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "secrets_encrypted" varchar NULL,
        "max_retries" integer NOT NULL DEFAULT 3,
        "retry_delay_seconds" integer NOT NULL DEFAULT 30,
        "timeout_seconds" integer NOT NULL DEFAULT 10,
        "workspace_events" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_by_user_id" varchar NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_triggers_tenant_name"
        ON "triggers" ("tenant_id", LOWER("name"))
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_triggers" (
        "agent_id" varchar NOT NULL,
        "trigger_id" varchar NOT NULL,
        "tenant_id" varchar NOT NULL,
        "events" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_agent_triggers" PRIMARY KEY ("agent_id", "trigger_id"),
        CONSTRAINT "FK_agent_triggers_agent" FOREIGN KEY ("agent_id")
          REFERENCES "agents" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_triggers_trigger" FOREIGN KEY ("trigger_id")
          REFERENCES "triggers" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_triggers_trigger" ON "agent_triggers" ("trigger_id")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trigger_events" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "trigger_id" varchar NULL,
        "trigger_name" varchar NOT NULL,
        "trigger_type" varchar NOT NULL,
        "agent_id" varchar NULL,
        "agent_name" varchar NULL,
        "event_type" varchar NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamp NULL DEFAULT NOW(),
        "last_error" text NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW(),
        "delivered_at" timestamp NULL,
        CONSTRAINT "FK_trigger_events_trigger" FOREIGN KEY ("trigger_id")
          REFERENCES "triggers" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trigger_events_queue"
        ON "trigger_events" ("next_attempt_at")
        WHERE "status" IN ('pending', 'delivering')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trigger_events_trigger_status"
        ON "trigger_events" ("trigger_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trigger_events_tenant_created"
        ON "trigger_events" ("tenant_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trigger_event_logs" (
        "id" varchar PRIMARY KEY,
        "event_id" varchar NOT NULL,
        "tenant_id" varchar NOT NULL,
        "attempt" integer NOT NULL,
        "started_at" timestamp NOT NULL DEFAULT NOW(),
        "duration_ms" integer NOT NULL DEFAULT 0,
        "success" boolean NOT NULL,
        "status_code" integer NULL,
        "error" text NULL,
        "response" text NULL,
        CONSTRAINT "FK_trigger_event_logs_event" FOREIGN KEY ("event_id")
          REFERENCES "trigger_events" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trigger_event_logs_event"
        ON "trigger_event_logs" ("event_id", "attempt")
    `);

    await this.migrateEmailProviders(queryRunner);
  }

  private async migrateEmailProviders(queryRunner: QueryRunner): Promise<void> {
    const hasTable = (await queryRunner.query(
      `SELECT to_regclass('public.email_provider_configs') IS NOT NULL AS present`,
    )) as Array<{ present: boolean }>;
    if (!hasTable[0]?.present) return;

    const rows = (await queryRunner.query(
      `SELECT c.tenant_id, c.provider, c.api_key_encrypted, c.domain, c.notification_email,
              c.is_active, c.created_by_user_id
         FROM email_provider_configs c
         JOIN tenants t ON t.id = c.tenant_id
        WHERE c.tenant_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM triggers tr WHERE tr.tenant_id = c.tenant_id AND tr.type = 'email')`,
    )) as Array<{
      tenant_id: string;
      provider: string;
      api_key_encrypted: string;
      domain: string | null;
      notification_email: string | null;
      is_active: boolean;
      created_by_user_id: string | null;
    }>;
    if (rows.length === 0) return;

    for (const row of rows) {
      let apiKey: string;
      try {
        apiKey = isEncrypted(row.api_key_encrypted)
          ? decryptWithAny(row.api_key_encrypted, getDecryptionSecrets()).plaintext
          : row.api_key_encrypted;
      } catch {
        // Undecryptable with the configured keys: nothing usable to carry over.
        continue;
      }
      const id = randomUUID();
      const label = row.provider.charAt(0).toUpperCase() + row.provider.slice(1);
      const config = {
        provider: row.provider,
        domain: row.domain ?? null,
        from: null,
        to: row.notification_email ? [row.notification_email] : [],
        subject: '[Thinker] {{event.title}}',
        body: '{{event.message}}',
        key_hint: `${apiKey.substring(0, 6)}…`,
      };
      await queryRunner.query(
        `INSERT INTO triggers (id, tenant_id, name, type, enabled, config, secrets_encrypted, created_by_user_id)
         VALUES ($1, $2, $3, 'email', $4, $5::jsonb, $6, $7)`,
        [
          id,
          row.tenant_id,
          `E-mail (${label})`,
          row.is_active !== false,
          JSON.stringify(config),
          encrypt(JSON.stringify({ apiKey }), getEncryptionSecret()),
          row.created_by_user_id,
        ],
      );
      await queryRunner.query(
        `INSERT INTO agent_triggers (agent_id, trigger_id, tenant_id, events)
         SELECT a.id, $1, a.tenant_id, '["limit.alert","limit.block"]'::jsonb
           FROM agents a
          WHERE a.tenant_id = $2 AND a.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM notification_rules r WHERE r.agent_id = a.id)
         ON CONFLICT DO NOTHING`,
        [id, row.tenant_id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "trigger_event_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trigger_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_triggers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "triggers"`);
  }
}
