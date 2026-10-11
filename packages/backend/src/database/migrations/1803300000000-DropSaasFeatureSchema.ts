import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the schema left behind by the removed Manifest Cloud and marketing
 * features (waitlist, CRM metrics feed, public error pages, managed Gemini
 * Free):
 *
 * - `waitlist_claims` (the pivot/Autofix waitlist) and `public_error_pages`
 *   (the marketing site's mirror pushed by the Peacock CMS). Their indexes and
 *   constraints go with them.
 * - `IDX_requests_autofix_healed`, the index that only served the CRM feed.
 *   1802200000000 built it in cloud mode only, so on a self-hosted database
 *   the drop is a no-op that never touches `requests`.
 * - Every `tenant_providers` connection to the managed `gemini-free` provider.
 *   Its endpoint (credits.manifest.build) and provider id no longer exist, so
 *   the stored LiteLLM virtual key can never be used again; keeping the row
 *   would leave a connection the dashboard cannot render and the proxy cannot
 *   route. Agent grants in `agent_enabled_providers` are deleted with it, and
 *   `agent_messages.tenant_provider_id` is nulled by its ON DELETE SET NULL
 *   foreign key, so history keeps its `provider = 'gemini-free'` label. Routes
 *   that still name the provider resolve as unavailable and fall through to
 *   their fallbacks, exactly as after a manual disconnect.
 *
 * `lock_timeout` makes the migration fail fast instead of queueing behind a
 * long-running query while holding up writes to the tables it locks; a failed
 * run is retried on the next boot. Every statement is idempotent.
 *
 * `down()` restores the two tables as the earlier migrations created them on
 * the self-hosted path, empty. The CRM index was never part of that path, and
 * the deleted connections cannot be restored.
 */
export class DropSaasFeatureSchema1803300000000 implements MigrationInterface {
  name = 'DropSaasFeatureSchema1803300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `DELETE FROM "agent_enabled_providers" WHERE "tenant_provider_id" IN (
         SELECT "id" FROM "tenant_providers" WHERE LOWER("provider") = 'gemini-free'
       )`,
    );
    await queryRunner.query(
      `DELETE FROM "tenant_providers" WHERE LOWER("provider") = 'gemini-free'`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_requests_autofix_healed"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "waitlist_claims"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "public_error_pages"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "waitlist_claims" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "email" varchar NOT NULL,
        "source" varchar NOT NULL DEFAULT 'self-hosted',
        "claimed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_waitlist_claims" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_waitlist_claims_email" UNIQUE ("email")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "public_error_pages" (
        "slug" varchar PRIMARY KEY,
        "cluster_key" varchar NOT NULL,
        "provider" varchar NOT NULL,
        "provider_label" varchar NOT NULL DEFAULT '',
        "http_status" integer,
        "category" varchar NOT NULL DEFAULT 'unknown',
        "category_label" varchar NOT NULL DEFAULT '',
        "title" varchar NOT NULL,
        "meta_description" varchar NOT NULL,
        "h1" varchar NOT NULL,
        "body_what" text NOT NULL DEFAULT '',
        "body_fix" text NOT NULL DEFAULT '',
        "body_manifest" text NOT NULL DEFAULT '',
        "sample_message" text NOT NULL DEFAULT '',
        "faq" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "stats" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "related" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "noindex" boolean NOT NULL DEFAULT false,
        "published_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  }
}
