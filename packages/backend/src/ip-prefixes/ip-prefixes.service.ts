import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { IpPrefixEntry } from '../entities/ip-prefix-list.entity';
import { MAX_ENTRIES_PER_LIST, normalizePrefix } from './ip-prefix-matcher';
import { clearIpRestrictionCache } from './ip-restriction-cache';

export interface IpPrefixListInput {
  name?: unknown;
  description?: unknown;
  entries?: unknown;
}

export interface IpPrefixListView {
  id: string;
  name: string;
  description: string | null;
  entries: Array<{ prefix: string; label: string | null }>;
  /** Harnesses with at least one key (not revoked) restricted to this list. */
  harnesses: Array<{ name: string; displayName: string }>;
  /** Keys (not revoked) whose IP restriction uses this list. */
  keys: Array<{ id: string; name: string; harness: string; harnessDisplayName: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface IpRestrictionView {
  enabled: boolean;
  listIds: string[];
}

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  entries: IpPrefixEntry[] | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function iso(v: string | Date): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function requireTenant(tenantId: string | null): string {
  if (!tenantId) throw new NotFoundException('No organization selected');
  return tenantId;
}

export function parseListName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new BadRequestException('name is required');
  if (name.length > 100) throw new BadRequestException('name must be at most 100 characters');
  return name;
}

export function parseDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new BadRequestException('description must be a string');
  const value = raw.trim();
  if (value.length > 500)
    throw new BadRequestException('description must be at most 500 characters');
  return value || null;
}

/** Validates and normalizes entries; duplicates (after normalization) collapse. */
export function parseEntries(raw: unknown): Array<{ prefix: string; label: string | null }> {
  if (!Array.isArray(raw)) throw new BadRequestException('entries must be a list');
  if (raw.length > MAX_ENTRIES_PER_LIST) {
    throw new BadRequestException(`A list holds at most ${MAX_ENTRIES_PER_LIST} entries`);
  }
  const seen = new Set<string>();
  const out: Array<{ prefix: string; label: string | null }> = [];
  for (const item of raw) {
    const obj = (typeof item === 'string' ? { prefix: item } : item) as {
      prefix?: unknown;
      label?: unknown;
    } | null;
    const rawPrefix = typeof obj?.prefix === 'string' ? obj.prefix : '';
    const prefix = normalizePrefix(rawPrefix);
    if (!prefix) {
      throw new BadRequestException(
        `Invalid IP address or prefix: "${rawPrefix.slice(0, 80)}". Use e.g. 203.0.113.7, 203.0.113.0/24 or 2001:db8::/48.`,
      );
    }
    const label =
      typeof obj?.label === 'string' && obj.label.trim() ? obj.label.trim().slice(0, 100) : null;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    out.push({ prefix, label });
  }
  return out;
}

/**
 * Organization IP prefix lists and the per-key source-IP restriction that
 * uses them. Raw SQL, like the proxy servers.
 */
@Injectable()
export class IpPrefixesService {
  constructor(private readonly ds: DataSource) {}

  async list(tenantId: string | null): Promise<{ lists: IpPrefixListView[] }> {
    if (!tenantId) return { lists: [] };
    const rows = (await this.ds.query(
      `SELECT id, name, description, entries, created_at, updated_at
         FROM ip_prefix_lists WHERE tenant_id = $1 ORDER BY lower(name)`,
      [tenantId],
    )) as ListRow[];
    const usage = await this.keysByList(this.ds.manager, tenantId);
    return { lists: rows.map((r) => this.view(r, usage.get(r.id) ?? [])) };
  }

  async get(tenantId: string | null, id: string): Promise<IpPrefixListView> {
    const tid = requireTenant(tenantId);
    const row = await this.findRow(this.ds.manager, tid, id);
    const usage = await this.keysByList(this.ds.manager, tid, id);
    return this.view(row, usage.get(id) ?? []);
  }

  async create(
    tenantId: string,
    userId: string | null,
    input: IpPrefixListInput,
  ): Promise<IpPrefixListView> {
    const name = parseListName(input.name);
    const description = parseDescription(input.description);
    const entries = parseEntries(input.entries ?? []);
    const id = randomUUID();
    await this.assertNameFree(tenantId, name, null);
    await this.ds.query(
      `INSERT INTO ip_prefix_lists (id, tenant_id, name, description, entries, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [id, tenantId, name, description, JSON.stringify(entries), userId],
    );
    return this.get(tenantId, id);
  }

  async update(
    tenantId: string | null,
    id: string,
    input: IpPrefixListInput,
  ): Promise<IpPrefixListView> {
    const tid = requireTenant(tenantId);
    const current = await this.findRow(this.ds.manager, tid, id);
    const name = input.name !== undefined ? parseListName(input.name) : current.name;
    const description =
      input.description !== undefined ? parseDescription(input.description) : current.description;
    const entries =
      input.entries !== undefined ? parseEntries(input.entries) : (current.entries ?? []);
    if (name.toLowerCase() !== current.name.toLowerCase()) await this.assertNameFree(tid, name, id);
    await this.ds.query(
      `UPDATE ip_prefix_lists SET name = $3, description = $4, entries = $5::jsonb, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tid, id, name, description, JSON.stringify(entries)],
    );
    clearIpRestrictionCache();
    return this.get(tid, id);
  }

  async remove(tenantId: string | null, id: string): Promise<{ ok: true }> {
    const tid = requireTenant(tenantId);
    await this.findRow(this.ds.manager, tid, id);
    const usage = await this.keysByList(this.ds.manager, tid, id);
    const keys = usage.get(id) ?? [];
    if (keys.length > 0) {
      throw new ConflictException({
        message: `This list is used by ${keys.length} API key(s). Remove it from them first.`,
        harnesses: harnessesOf(keys),
        keys,
      });
    }
    await this.ds.transaction(async (m) => {
      // Revoked keys never authenticate again: their links do not hold the list.
      await m.query(`DELETE FROM agent_api_key_ip_prefix_lists WHERE list_id = $1`, [id]);
      await m.query(`DELETE FROM ip_prefix_lists WHERE tenant_id = $1 AND id = $2`, [tid, id]);
    });
    clearIpRestrictionCache();
    return { ok: true };
  }

  async getRestriction(
    tenantId: string | null,
    agentName: string,
    keyId: string,
  ): Promise<IpRestrictionView> {
    const tid = requireTenant(tenantId);
    const key = await this.findKey(this.ds.manager, tid, agentName, keyId);
    const links = (await this.ds.query(
      `SELECT list_id FROM agent_api_key_ip_prefix_lists WHERE key_id = $1 ORDER BY created_at, list_id`,
      [key.id],
    )) as Array<{ list_id: string }>;
    return { enabled: key.ip_restriction_enabled, listIds: links.map((l) => l.list_id) };
  }

  async setRestriction(
    tenantId: string | null,
    agentName: string,
    keyId: string,
    input: { enabled?: unknown; listIds?: unknown },
  ): Promise<IpRestrictionView> {
    const tid = requireTenant(tenantId);
    if (typeof input.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false');
    }
    const rawIds = input.listIds ?? [];
    if (!Array.isArray(rawIds) || rawIds.some((v) => typeof v !== 'string')) {
      throw new BadRequestException('listIds must be a list of list ids');
    }
    const listIds = [...new Set(rawIds as string[])];
    if (input.enabled && listIds.length === 0) {
      throw new BadRequestException('Pick at least one IP prefix list to restrict the source IP');
    }
    await this.ds.transaction(async (m) => {
      const key = await this.findKey(m, tid, agentName, keyId);
      if (key.revoked) throw new ConflictException('This key is revoked');
      if (listIds.length > 0) {
        const found = (await m.query(
          `SELECT id FROM ip_prefix_lists WHERE tenant_id = $1 AND id = ANY($2::varchar[])`,
          [tid, listIds],
        )) as Array<{ id: string }>;
        if (found.length !== listIds.length) {
          throw new BadRequestException('Unknown IP prefix list');
        }
      }
      await m.query(`DELETE FROM agent_api_key_ip_prefix_lists WHERE key_id = $1`, [key.id]);
      for (const listId of listIds) {
        await m.query(
          `INSERT INTO agent_api_key_ip_prefix_lists (key_id, list_id, tenant_id) VALUES ($1, $2, $3)`,
          [key.id, listId, tid],
        );
      }
      await m.query(`UPDATE agent_api_keys SET ip_restriction_enabled = $2 WHERE id = $1`, [
        key.id,
        input.enabled,
      ]);
    });
    clearIpRestrictionCache();
    return this.getRestriction(tid, agentName, keyId);
  }

  private view(row: ListRow, keys: IpPrefixListView['keys']): IpPrefixListView {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      entries: (row.entries ?? []).map((e) => ({ prefix: e.prefix, label: e.label ?? null })),
      harnesses: harnessesOf(keys),
      keys,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private async findRow(m: EntityManager, tenantId: string, id: string): Promise<ListRow> {
    const rows = (await m.query(
      `SELECT id, name, description, entries, created_at, updated_at
         FROM ip_prefix_lists WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    )) as ListRow[];
    if (!rows[0]) throw new NotFoundException('IP prefix list not found');
    return rows[0];
  }

  private async findKey(
    m: EntityManager,
    tenantId: string,
    agentName: string,
    keyId: string,
  ): Promise<{ id: string; ip_restriction_enabled: boolean; revoked: boolean }> {
    const rows = (await m.query(
      `SELECT k.id, k.ip_restriction_enabled, k.revoked_at IS NOT NULL AS revoked
         FROM agent_api_keys k
         JOIN agents a ON a.id = k.agent_id
        WHERE a.tenant_id = $1 AND a.name = $2 AND a.deleted_at IS NULL AND k.id = $3`,
      [tenantId, agentName, keyId],
    )) as Array<{ id: string; ip_restriction_enabled: boolean; revoked: boolean }>;
    if (!rows[0]) throw new NotFoundException('Key not found');
    return rows[0];
  }

  private async assertNameFree(tenantId: string, name: string, exceptId: string | null) {
    const rows = (await this.ds.query(
      `SELECT id FROM ip_prefix_lists WHERE tenant_id = $1 AND lower(name) = lower($2)`,
      [tenantId, name],
    )) as Array<{ id: string }>;
    if (rows.some((r) => r.id !== exceptId)) {
      throw new ConflictException(`An IP prefix list named "${name}" already exists`);
    }
  }

  private async keysByList(
    m: EntityManager,
    tenantId: string,
    listId?: string,
  ): Promise<Map<string, IpPrefixListView['keys']>> {
    const rows = (await m.query(
      `SELECT kl.list_id, k.id, COALESCE(k.name, CASE WHEN k.is_primary THEN 'Primary key' ELSE k.label END, k.key_prefix) AS key_name,
              a.name, COALESCE(a.display_name, a.name) AS display_name
         FROM agent_api_key_ip_prefix_lists kl
         JOIN agent_api_keys k ON k.id = kl.key_id AND k.revoked_at IS NULL
         JOIN agents a ON a.id = k.agent_id AND a.deleted_at IS NULL
        WHERE kl.tenant_id = $1 ${listId ? 'AND kl.list_id = $2' : ''}
        ORDER BY lower(a.name), k.is_primary DESC, k.created_at`,
      listId ? [tenantId, listId] : [tenantId],
    )) as Array<{
      list_id: string;
      id: string;
      key_name: string;
      name: string;
      display_name: string;
    }>;
    const map = new Map<string, IpPrefixListView['keys']>();
    for (const r of rows) {
      const arr = map.get(r.list_id) ?? [];
      arr.push({ id: r.id, name: r.key_name, harness: r.name, harnessDisplayName: r.display_name });
      map.set(r.list_id, arr);
    }
    return map;
  }
}

function harnessesOf(keys: IpPrefixListView['keys']): IpPrefixListView['harnesses'] {
  const seen = new Map<string, string>();
  for (const k of keys) if (!seen.has(k.harness)) seen.set(k.harness, k.harnessDisplayName);
  return [...seen].map(([name, displayName]) => ({ name, displayName }));
}
