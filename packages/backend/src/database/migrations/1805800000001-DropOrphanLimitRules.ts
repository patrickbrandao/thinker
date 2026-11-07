import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting a harness now deletes its limit rules. Rules left behind by
 * harnesses deleted before that are removed here, except where a live harness
 * with the same name already exists: those rules have been applying to it
 * (rules match by name) and show on its Limits tab, so they stay.
 */
export class DropOrphanLimitRules1805800000001 implements MigrationInterface {
  name = 'DropOrphanLimitRules1805800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "notification_rules" r
       WHERE EXISTS (
               SELECT 1 FROM "agents" a
                WHERE a.id = r.agent_id AND a.deleted_at IS NOT NULL)
         AND NOT EXISTS (
               SELECT 1 FROM "agents" live
                WHERE live.tenant_id = r.tenant_id
                  AND live.name = r.agent_name
                  AND live.deleted_at IS NULL)`);
  }

  public async down(): Promise<void> {
    // Deleted rules of deleted harnesses are not restored.
  }
}
