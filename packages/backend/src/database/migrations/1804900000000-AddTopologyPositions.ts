import { MigrationInterface, QueryRunner } from 'typeorm';

/** Node positions of the topology canvas, saved per workspace. */
export class AddTopologyPositions1804900000000 implements MigrationInterface {
  name = 'AddTopologyPositions1804900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "topology_positions" (
        "tenant_id" varchar NOT NULL,
        "node_id" varchar(300) NOT NULL,
        "x" integer NOT NULL,
        "y" integer NOT NULL,
        "updated_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_topology_positions" PRIMARY KEY ("tenant_id", "node_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "topology_positions"`);
  }
}
