import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Request } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ApiKey } from '../entities/api-key.entity';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';
import { Audit } from '../alerts/audit.decorator';
import { hashKey, keyPrefix } from '../common/utils/hash.util';
import { toLocalSqlTimestamp } from '../common/utils/postgres-sql';
import { clientIpLogFields } from '../common/utils/client-ip';
import { CLI_KEY_NAME } from './cli-auth.service';

import { ADMIN_KEY_PREFIX } from '../common/services/api-key-auth.service';

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  /** Days until the key expires; omitted or null = never expires. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expires_in_days?: number | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  kind: 'admin' | 'cli';
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
}

/**
 * Management API keys of the active organization: one credential for the
 * REST API, the CLI and MCP. The key carries its creator's current role.
 */
@MinRole('admin', { includeReads: true })
@Controller('api/v1/api-keys')
export class ApiKeysController {
  private readonly logger = new Logger('ManagementAudit');

  constructor(
    @InjectRepository(ApiKey) private readonly repo: Repository<ApiKey>,
    private readonly ds: DataSource,
  ) {}

  @Get()
  async list(@TenantCtx() ctx: TenantContext): Promise<{ keys: ApiKeyRow[] }> {
    if (!ctx.tenantId) return { keys: [] };
    const rows = (await this.ds.query(
      `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.expires_at,
              k.created_by_user_id, u.email AS created_by_email
         FROM api_keys k LEFT JOIN "user" u ON u.id = k.created_by_user_id
        WHERE k.tenant_id = $1
        ORDER BY k.created_at DESC`,
      [ctx.tenantId],
    )) as Array<Omit<ApiKeyRow, 'kind'>>;
    return {
      keys: rows.map((r) => ({ ...r, kind: r.name === CLI_KEY_NAME ? 'cli' : 'admin' })),
    };
  }

  @Post()
  @Audit({ entity: 'api_key', action: 'created' })
  async create(
    @Body() dto: CreateApiKeyDto,
    @TenantCtx() ctx: TenantContext,
    @Req() req: Request,
  ): Promise<{
    id: string;
    name: string;
    key: string;
    key_prefix: string;
    expires_at: string | null;
  }> {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException('Create an organization first');
    }
    const name = dto.name.trim();
    if (!name || name === CLI_KEY_NAME) {
      throw new BadRequestException(`Name must not be empty or "${CLI_KEY_NAME}"`);
    }
    const key = ADMIN_KEY_PREFIX + randomBytes(32).toString('base64url');
    const expires = dto.expires_in_days
      ? new Date(Date.now() + dto.expires_in_days * 86_400_000)
      : null;
    const id = randomUUID();
    await this.repo.insert({
      id,
      key: null,
      key_hash: hashKey(key),
      key_prefix: keyPrefix(key),
      tenant_id: ctx.tenantId,
      created_by_user_id: ctx.userId,
      name,
      expires_at: expires ? toLocalSqlTimestamp(expires) : null,
      absolute_expires_at: null,
    });
    this.logger.log(
      `API key created: id=${id} name=${name} tenant=${ctx.tenantId} user=${ctx.userId} ` +
        `expires=${expires ? expires.toISOString() : 'never'} ${clientIpLogFields(req)}`,
    );
    return {
      id,
      name,
      key,
      key_prefix: keyPrefix(key),
      expires_at: expires ? expires.toISOString() : null,
    };
  }

  @Delete(':id')
  @HttpCode(200)
  @Audit({
    entity: 'api_key',
    action: 'deleted',
    lookup: { table: 'api_keys', nameColumn: 'name' },
  })
  async revoke(
    @Param('id') id: string,
    @TenantCtx() ctx: TenantContext,
    @Req() req: Request,
  ): Promise<{ revoked: true; id: string }> {
    const found = ctx.tenantId
      ? await this.repo.findOne({ where: { id, tenant_id: ctx.tenantId } })
      : null;
    if (!found) throw new NotFoundException('API key not found');
    await this.repo.delete({ id: found.id });
    this.logger.log(
      `API key revoked: id=${id} name=${found.name} tenant=${ctx.tenantId} user=${ctx.userId ?? '-'} ${clientIpLogFields(req)}`,
    );
    return { revoked: true, id };
  }
}
