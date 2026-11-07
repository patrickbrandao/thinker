import { clientIpLogFields } from '../utils/client-ip';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestWithTenantContext } from '../decorators/tenant-context.decorator';
import { ApiKeyAuthService, ManagementAuth } from '../services/api-key-auth.service';
// Same header as auth/session.guard.ts (not imported: that module loads the ESM-only auth instance).
const ORGANIZATION_HEADER = 'x-thinker-organization';

/** Request fields set for a management credential (read by /me and the audit trail). */
export type RequestWithManagementAuth = Request & {
  authMethod?: string;
  apiKeyExpiresAt?: string | null;
  managementAuth?: Pick<ManagementAuth, 'kind' | 'keyId' | 'keyName'>;
};

/**
 * Writes one log line per request made with a management credential (admin
 * API key, CLI token or root token), once the response is sent: who, which
 * key, what, and the outcome. Never the key itself.
 */
export function logManagementRequest(
  logger: Logger,
  request: Request,
  response: Response | undefined,
  auth: ManagementAuth,
  surface: string,
): void {
  const line = (status: number | string) =>
    `Management ${surface} request: ${request.method} ${request.originalUrl ?? request.url} ` +
    `status=${status} credential=${auth.kind} key=${auth.keyName}` +
    `${auth.keyId ? ` key_id=${auth.keyId}` : ''} user=${auth.ctx.userId ?? '-'} ` +
    `tenant=${auth.ctx.tenantId ?? '-'} ${clientIpLogFields(request)}`;
  if (!response || typeof response.once !== 'function') {
    logger.log(line('-'));
    return;
  }
  response.once('finish', () => logger.log(line(response.statusCode)));
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly auditLogger = new Logger('ManagementAudit');

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly keyAuth: ApiKeyAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithManagementAuth>();

    // Skip if already authenticated via session (explicit flag prevents accidental bypass)
    if (request.authMethod === 'session') return true;

    const apiKey = request.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      this.logger.warn(`Rejected request without API key from ${clientIpLogFields(request)}`);
      // `code: unauthenticated` is what the dashboard keys on to send an
      // expired session back to /login (services/api/core.ts).
      throw new UnauthorizedException({
        message: 'X-API-Key header required',
        error: 'Unauthorized',
        statusCode: 401,
        code: 'unauthenticated',
      });
    }

    const header = request.headers[ORGANIZATION_HEADER];
    const requested = typeof header === 'string' && header ? header : null;
    let auth: ManagementAuth | null;
    try {
      auth = await this.keyAuth.authenticate(apiKey, requested);
    } catch (err) {
      this.logger.warn(
        `Rejected management credential (${err instanceof Error ? err.message : err}) from ${clientIpLogFields(request)}`,
      );
      throw err;
    }

    if (auth) {
      (request as RequestWithTenantContext).tenantContext = auth.ctx;
      if (auth.ctx.userId) {
        (request as Request & { user: { id: string } }).user = { id: String(auth.ctx.userId) };
      }
      request.authMethod = auth.kind;
      request.apiKeyExpiresAt = auth.expiresAt;
      request.managementAuth = { kind: auth.kind, keyId: auth.keyId, keyName: auth.keyName };
      logManagementRequest(
        this.auditLogger,
        request,
        typeof context.switchToHttp().getResponse === 'function'
          ? context.switchToHttp().getResponse<Response>()
          : undefined,
        auth,
        'API',
      );
      return true;
    }

    // Fall back to env-based API key (for simple setups). The env key is a
    // shared operator credential not tied to any user; controllers that
    // depend on @CurrentUser will reject the request when `request.user`
    // is unset (see CurrentUser decorator).
    const validKey = this.configService.get<string>('app.apiKey', '');
    if (validKey && this.safeCompare(apiKey, validKey)) {
      request.authMethod = 'env_api_key';
      this.auditLogger.log(
        `Management API request: ${request.method} ${request.originalUrl ?? request.url} credential=env_api_key ${clientIpLogFields(request)}`,
      );
      return true;
    }

    this.logger.warn(`Rejected invalid API key from ${clientIpLogFields(request)}`);
    throw new UnauthorizedException('Invalid API key');
  }

  private safeCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    // timingSafeEqual requires equal-length inputs. A length mismatch is
    // a definite mismatch, and the length of the configured env-based
    // API_KEY is not a secret worth hiding.
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }
}
