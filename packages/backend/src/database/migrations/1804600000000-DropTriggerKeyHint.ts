import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddEventTriggers kept the first characters of each migrated e-mail API key
 * as `config.key_hint`, in plain text. Nothing reads it (the public view drops
 * it), so remove it from every trigger.
 */
export class DropTriggerKeyHint1804600000000 implements MigrationInterface {
  name = 'DropTriggerKeyHint1804600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE triggers SET config = config - 'key_hint' WHERE config ? 'key_hint'`,
    );
  }

  async down(): Promise<void> {
    // The hint is gone for good; nothing to restore.
  }
}
