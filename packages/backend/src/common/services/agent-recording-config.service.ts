import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../../entities/agent.entity';
import { DEFAULT_RECORDING_RETENTION_DAYS } from '../../config/recording-retention';

export interface AgentLogSettings {
  enabled: boolean;
  /** The harness override in days; null follows the organization. */
  retention_days: number | null;
  /** The organization's retention (or the environment default) in days. */
  global_retention_days: number;
}

@Injectable()
export class AgentRecordingConfigService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    private readonly config: ConfigService,
  ) {}

  async isRecording(agentId: string | null | undefined): Promise<boolean> {
    if (!agentId) return false;
    // This setting controls whether Thinker stores request and response bodies.
    // Read it fresh so a choice changed on one replica applies to all replicas.
    const agent = await this.agentRepo.findOne({
      where: { id: agentId },
      select: { id: true, record_messages: true },
    });
    return agent?.record_messages === true;
  }

  /** THINKER_RECORDING_RETENTION_DAYS, the value under every organization. */
  envRetentionDays(): number {
    return (
      this.config.get<number>('app.requestRecordingRetentionDays') ??
      DEFAULT_RECORDING_RETENTION_DAYS
    );
  }

  async logSettings(agentId: string): Promise<AgentLogSettings> {
    const rows = (await this.agentRepo.manager.query(
      `SELECT a.record_messages, a.log_retention_days, t.log_retention_days AS tenant_days
         FROM agents a LEFT JOIN tenants t ON t.id = a.tenant_id
        WHERE a.id = $1`,
      [agentId],
    )) as Array<{
      record_messages: boolean;
      log_retention_days: number | null;
      tenant_days: number | null;
    }>;
    const row = rows[0];
    return {
      enabled: row?.record_messages === true,
      retention_days: row?.log_retention_days ?? null,
      global_retention_days: row?.tenant_days ?? this.envRetentionDays(),
    };
  }
}
