import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbound proxy servers (tmp/PROXY-SPEC.md).
 *
 * - `proxy_servers`: workspace-scoped HTTP(S) proxies. The password is
 *   encrypted like provider keys.
 * - `proxy_bindings`: ordered chains per bound object (`provider`,
 *   `connection`, `trigger`, `email_config`). A NULL `proxy_id` is the
 *   "Direct" item. A connection without rows inherits from its provider.
 * - `proxy_logs`: one row per connection sent to a proxy (only failures unless
 *   the proxy is in debug). Pruned by the request-recording retention job.
 * - `proxy_usage_daily`: daily rollup that survives log retention and proxy
 *   removal (no foreign key on `proxy_id`).
 * - `egress` / `egress_hops` on attempts and trigger delivery logs.
 */
export class AddProxyServers1804700000000 implements MigrationInterface {
  name = 'AddProxyServers1804700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_servers" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "name" varchar(100) NOT NULL,
        "scheme" varchar(5) NOT NULL DEFAULT 'http',
        "host" varchar(255) NOT NULL,
        "port" integer NOT NULL,
        "username" varchar(255) NULL,
        "password_encrypted" varchar NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "connect_timeout_ms" integer NOT NULL DEFAULT 10000,
        "debug_enabled" boolean NOT NULL DEFAULT false,
        "debug_until" timestamp NULL,
        "log_retention_days" integer NULL,
        "created_by_user_id" varchar NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_proxy_servers_tenant_name"
        ON "proxy_servers" ("tenant_id", LOWER("name"))
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_bindings" (
        "tenant_id" varchar NOT NULL,
        "target_type" varchar(20) NOT NULL,
        "target_id" varchar NOT NULL,
        "position" integer NOT NULL,
        "proxy_id" varchar NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_proxy_bindings" PRIMARY KEY ("tenant_id", "target_type", "target_id", "position"),
        CONSTRAINT "FK_proxy_bindings_proxy" FOREIGN KEY ("proxy_id")
          REFERENCES "proxy_servers" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_proxy_bindings_proxy" ON "proxy_bindings" ("proxy_id")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_logs" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "proxy_id" varchar NULL,
        "proxy_name" varchar(100) NOT NULL,
        "started_at" timestamp NOT NULL DEFAULT NOW(),
        "duration_ms" integer NOT NULL DEFAULT 0,
        "tunnel_ms" integer NULL,
        "source_type" varchar(20) NOT NULL,
        "source_id" varchar NULL,
        "source_label" varchar NULL,
        "destination" varchar NOT NULL,
        "position" integer NOT NULL DEFAULT 1,
        "result" varchar(32) NOT NULL,
        "status_code" integer NULL,
        "bytes_sent" bigint NOT NULL DEFAULT 0,
        "bytes_received" bigint NOT NULL DEFAULT 0,
        "request_id" varchar NULL,
        "agent_message_id" varchar NULL,
        "error" text NULL,
        CONSTRAINT "FK_proxy_logs_proxy" FOREIGN KEY ("proxy_id")
          REFERENCES "proxy_servers" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_proxy_logs_tenant_proxy_started"
        ON "proxy_logs" ("tenant_id", "proxy_id", "started_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_proxy_logs_started" ON "proxy_logs" ("started_at")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_usage_daily" (
        "tenant_id" varchar NOT NULL,
        "proxy_id" varchar NOT NULL,
        "proxy_name" varchar(100) NOT NULL,
        "day" date NOT NULL,
        "source_type" varchar(20) NOT NULL,
        "source_id" varchar NOT NULL DEFAULT '',
        "connections" integer NOT NULL DEFAULT 0,
        "successes" integer NOT NULL DEFAULT 0,
        "failures" integer NOT NULL DEFAULT 0,
        "failures_by_code" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "tunnel_ms_sum" bigint NOT NULL DEFAULT 0,
        "tunnel_ms_max" integer NOT NULL DEFAULT 0,
        "tunnel_samples" integer NOT NULL DEFAULT 0,
        "bytes_sent" bigint NOT NULL DEFAULT 0,
        "bytes_received" bigint NOT NULL DEFAULT 0,
        "fallback_uses" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_proxy_usage_daily"
          PRIMARY KEY ("tenant_id", "proxy_id", "day", "source_type", "source_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_proxy_usage_daily_tenant_day"
        ON "proxy_usage_daily" ("tenant_id", "day")
    `);
    for (const table of ['agent_messages', 'trigger_event_logs']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "egress" jsonb NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "egress_hops" jsonb NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['agent_messages', 'trigger_event_logs']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "egress_hops"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "egress"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_usage_daily"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_bindings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_servers"`);
  }
}
