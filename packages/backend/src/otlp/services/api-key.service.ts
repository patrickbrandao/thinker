import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { Tenant } from '../../entities/tenant.entity';
import { Agent } from '../../entities/agent.entity';
import { AgentApiKey } from '../../entities/agent-api-key.entity';
import { hashKey, keyPrefix } from '../../common/utils/hash.util';
import {
  encrypt,
  decryptWithAny,
  getEncryptionSecret,
  getDecryptionSecrets,
} from '../../common/utils/crypto.util';
import { API_KEY_PREFIX } from '../../common/constants/api-key.constants';
import { toLocalSqlTimestamp } from '../../common/utils/postgres-sql';
import { TenantCacheService } from '../../common/services/tenant-cache.service';
import { AgentKeyAuthGuard } from '../guards/agent-key-auth.guard';

@Injectable()
export class ApiKeyGeneratorService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentApiKey)
    private readonly keyRepo: Repository<AgentApiKey>,
    private readonly otlpAuthGuard: AgentKeyAuthGuard,
    private readonly tenantCache: TenantCacheService,
  ) {}

  private generateKey(): string {
    return API_KEY_PREFIX + randomBytes(32).toString('base64url');
  }

  async onboardAgent(params: {
    /** Known tenant (e.g. from an API-key context). Skips owner resolution. */
    tenantId?: string | null;
    /** Owner to resolve (and lazily create) the tenant for, when no tenantId is known. */
    ownerUserId?: string | null;
    agentName: string;
    organizationName?: string;
    email?: string;
    agentDescription?: string;
    displayName?: string;
    agentCategory?: string;
    agentPlatform?: string;
    /** Explicit recording choice. Undefined → column default (true for new agents). */
    recordMessages?: boolean;
    /** Harness log retention in days; null/undefined follows the organization. */
    logRetentionDays?: number | null;
  }): Promise<{ tenantId: string; agentId: string; apiKey: string }> {
    let tenantId: string;
    if (params.tenantId) {
      tenantId = params.tenantId;
    } else if (params.ownerUserId) {
      // The user's active organization, or a personal one they own (ADR 0006).
      tenantId = await this.tenantCache.ensureForUser(params.ownerUserId);
    } else {
      throw new NotFoundException('No tenant available for agent onboarding');
    }

    const agentId = randomUUID();
    await this.agentRepo.insert({
      id: agentId,
      name: params.agentName,
      display_name: params.displayName ?? null,
      description: params.agentDescription ?? null,
      agent_category: params.agentCategory ?? null,
      agent_platform: params.agentPlatform ?? null,
      // Only set when the caller made an explicit choice. Leaving it out lets
      // the column default apply (recording ON for new agents).
      ...(params.recordMessages !== undefined ? { record_messages: params.recordMessages } : {}),
      log_retention_days: params.logRetentionDays ?? null,
      is_active: true,
      tenant_id: tenantId,
    });

    const rawKey = this.generateKey();
    const keyId = randomUUID();
    await this.keyRepo.insert({
      id: keyId,
      key: encrypt(rawKey, getEncryptionSecret()),
      key_hash: hashKey(rawKey),
      key_prefix: keyPrefix(rawKey),
      label: `${params.agentName} ingest key`,
      tenant_id: tenantId,
      agent_id: agentId,
      is_active: true,
      is_primary: true,
    });

    return { tenantId, agentId, apiKey: rawKey };
  }

  async getKeyForAgent(
    tenantId: string,
    agentName: string,
  ): Promise<{ keyPrefix: string; fullKey?: string }> {
    const keyRecord = await this.keyRepo
      .createQueryBuilder('k')
      .leftJoin('k.agent', 'a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.name = :agentName', { agentName })
      .andWhere('a.deleted_at IS NULL')
      .andWhere('k.is_primary = true')
      .andWhere('k.revoked_at IS NULL')
      .getOne();

    if (!keyRecord) {
      throw new NotFoundException('No primary API key found for this agent');
    }

    if (keyRecord.key) {
      try {
        const fullKey = decryptWithAny(keyRecord.key, getDecryptionSecrets()).plaintext;
        return { keyPrefix: keyRecord.key_prefix, fullKey };
      } catch {
        return { keyPrefix: keyRecord.key_prefix };
      }
    }

    return { keyPrefix: keyRecord.key_prefix };
  }

  /** Replaces the harness's primary key; its other keys are untouched. */
  async rotateKey(tenantId: string, agentName: string): Promise<{ apiKey: string }> {
    const agent = await this.findAgent(tenantId, agentName);

    await this.keyRepo.delete({ agent_id: agent.id, is_primary: true });
    this.otlpAuthGuard.clearCache();

    const rawKey = this.generateKey();
    const keyId = randomUUID();
    await this.keyRepo.insert({
      id: keyId,
      key: encrypt(rawKey, getEncryptionSecret()),
      key_hash: hashKey(rawKey),
      key_prefix: keyPrefix(rawKey),
      label: `${agent.name} ingest key (rotated)`,
      tenant_id: agent.tenant_id,
      agent_id: agent.id,
      is_active: true,
      is_primary: true,
    });

    return { apiKey: rawKey };
  }

  /** Every key of the harness, primary first, then newest first. */
  async listKeys(tenantId: string, agentName: string): Promise<AgentKeyView[]> {
    const agent = await this.findAgent(tenantId, agentName);
    const rows = await this.keyRepo.find({
      where: { agent_id: agent.id },
      order: { is_primary: 'DESC', created_at: 'DESC' },
    });
    return rows.map((r) => toKeyView(r));
  }

  /**
   * An extra key: named, with a mandatory expiry, shown once. Its plaintext is
   * not stored (only the hash), unlike the primary key.
   */
  async createKey(
    tenantId: string,
    agentName: string,
    input: { name?: unknown; expiresAt?: unknown },
  ): Promise<{ key: AgentKeyView; apiKey: string }> {
    const agent = await this.findAgent(tenantId, agentName);
    const name = parseKeyName(input.name);
    const expiresAt = parseKeyExpiry(input.expiresAt);
    const count = await this.keyRepo.count({ where: { agent_id: agent.id, revoked_at: IsNull() } });
    if (count >= MAX_KEYS_PER_AGENT) {
      throw new ConflictException(
        `A harness can have at most ${MAX_KEYS_PER_AGENT} keys that are not revoked`,
      );
    }

    const rawKey = this.generateKey();
    const row: Partial<AgentApiKey> = {
      id: randomUUID(),
      key: null,
      key_hash: hashKey(rawKey),
      key_prefix: keyPrefix(rawKey),
      label: name,
      name,
      tenant_id: agent.tenant_id,
      agent_id: agent.id,
      is_active: true,
      is_primary: false,
      expires_at: toLocalSqlTimestamp(expiresAt),
    };
    await this.keyRepo.insert(row);
    this.otlpAuthGuard.clearCache();
    const saved = await this.keyRepo.findOneByOrFail({ id: row.id! });
    return { key: toKeyView(saved), apiKey: rawKey };
  }

  /** Renames, disables or re-enables a key. A revoked key cannot change. */
  async updateKey(
    tenantId: string,
    agentName: string,
    keyId: string,
    input: { name?: unknown; disabled?: unknown },
  ): Promise<AgentKeyView> {
    const key = await this.findKey(tenantId, agentName, keyId);
    if (key.revoked_at) throw new ConflictException('This key is revoked');
    const patch: Partial<AgentApiKey> = {};
    if (input.name !== undefined) {
      patch.name = parseKeyName(input.name);
      patch.label = patch.name;
    }
    if (input.disabled !== undefined) {
      if (typeof input.disabled !== 'boolean') {
        throw new BadRequestException('disabled must be true or false');
      }
      patch.is_active = !input.disabled;
    }
    if (Object.keys(patch).length > 0) {
      await this.keyRepo.update({ id: key.id }, patch);
      this.otlpAuthGuard.clearCache();
    }
    return toKeyView(await this.keyRepo.findOneByOrFail({ id: key.id }));
  }

  /** Revokes an extra key for good. The primary key is rotated or disabled instead. */
  async revokeKey(tenantId: string, agentName: string, keyId: string): Promise<AgentKeyView> {
    const key = await this.findKey(tenantId, agentName, keyId);
    if (key.is_primary) {
      throw new ConflictException('The primary key cannot be revoked; rotate or disable it');
    }
    if (!key.revoked_at) {
      await this.keyRepo.update(
        { id: key.id },
        { is_active: false, revoked_at: toLocalSqlTimestamp(new Date()) },
      );
      this.otlpAuthGuard.clearCache();
    }
    return toKeyView(await this.keyRepo.findOneByOrFail({ id: key.id }));
  }

  private async findAgent(tenantId: string, agentName: string): Promise<Agent> {
    const agent = await this.agentRepo
      .createQueryBuilder('a')
      .where('a.name = :agentName', { agentName })
      .andWhere('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.deleted_at IS NULL')
      .getOne();
    if (!agent) throw new NotFoundException('Agent not found or access denied');
    return agent;
  }

  private async findKey(tenantId: string, agentName: string, keyId: string): Promise<AgentApiKey> {
    const agent = await this.findAgent(tenantId, agentName);
    const key = await this.keyRepo.findOneBy({ id: keyId, agent_id: agent.id });
    if (!key) throw new NotFoundException('Key not found');
    return key;
  }
}

/** Keys a harness may hold at once, primary included (revoked ones do not count). */
export const MAX_KEYS_PER_AGENT = 50;
/** Longest lifetime an extra key may be given. */
export const MAX_KEY_LIFETIME_DAYS = 365;

export type AgentKeyStatus = 'active' | 'disabled' | 'expired' | 'revoked';

export interface AgentKeyView {
  id: string;
  name: string | null;
  keyPrefix: string;
  isPrimary: boolean;
  status: AgentKeyStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

function iso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function keyStatus(
  row: Pick<AgentApiKey, 'is_active' | 'revoked_at' | 'expires_at'>,
  now = Date.now(),
): AgentKeyStatus {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired';
  return row.is_active ? 'active' : 'disabled';
}

export function toKeyView(row: AgentApiKey): AgentKeyView {
  return {
    id: row.id,
    name: row.name ?? (row.is_primary ? 'Primary key' : row.label),
    keyPrefix: row.key_prefix,
    isPrimary: row.is_primary,
    status: keyStatus(row),
    expiresAt: iso(row.expires_at),
    lastUsedAt: iso(row.last_used_at),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    revokedAt: iso(row.revoked_at),
  };
}

export function parseKeyName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new BadRequestException('name is required');
  if (name.length > 100) throw new BadRequestException('name must be at most 100 characters');
  return name;
}

/** ISO date-time in the future, at most MAX_KEY_LIFETIME_DAYS ahead. */
export function parseKeyExpiry(raw: unknown, now = Date.now()): Date {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException('expiresAt is required: new keys must expire');
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new BadRequestException('expiresAt is not a valid date');
  if (at.getTime() <= now + 60_000) {
    throw new BadRequestException('expiresAt must be in the future');
  }
  if (at.getTime() > now + MAX_KEY_LIFETIME_DAYS * 86_400_000 + 86_400_000) {
    throw new BadRequestException(`expiresAt must be at most ${MAX_KEY_LIFETIME_DAYS} days ahead`);
  }
  return at;
}
