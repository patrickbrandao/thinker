import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import type { LiveEvent } from 'thinker-shared';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { canViewRequestHeaders } from '../analytics/controllers/messages.controller';
import {
  LIVE_MAX_CONNECTIONS_PER_TENANT,
  LiveSessionHubService,
  type LiveSubscriber,
} from './live-session-hub.service';
import {
  EVENTS_DEFAULT_LIMIT,
  EVENTS_MAX_LIMIT,
  LiveSessionHistoryService,
} from './live-session-history.service';
import { sseFrame, type LiveViewerAccess } from './live-wire';

export const LIVE_HEARTBEAT_MS = 15_000;
/** A connection whose unsent output passes this is closed (the client resumes). */
export const LIVE_MAX_PENDING_BYTES = 1024 * 1024;

export class LiveStreamQueryDto {
  /** Fallback for clients that cannot send the `Last-Event-ID` header. */
  @IsOptional()
  @Matches(/^\d{1,16}$/)
  lastEventId?: string;
  /**
   * Active organization for EventSource clients (they cannot send the
   * `X-Thinker-Organization` header); SessionGuard reads and checks it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;
}

export class LiveEventsQueryDto {
  @IsOptional()
  @Matches(/^\d{1,16}$/)
  after?: string;

  @IsOptional()
  @Matches(/^\d{1,16}$/)
  until?: string;

  @IsOptional()
  @Matches(/^\d{1,5}$/)
  limit?: string;
}

/**
 * Who sees what (docs/dev/janela-sessao-ao-vivo.md, "Segurança"): the
 * session is visible with the same scope as `GET /sessions/:id`; request
 * bodies follow the attempt recordings (every member who sees the session's
 * requests), provider-facing headers the request headers (owner/admin).
 */
function viewerAccess(ctx: TenantContext): LiveViewerAccess {
  return { bodies: true, headers: canViewRequestHeaders(ctx) };
}

@SkipThrottle()
@Controller('api/v1')
export class LiveSessionController {
  private readonly logger = new Logger(LiveSessionController.name);

  constructor(
    private readonly hub: LiveSessionHubService,
    private readonly history: LiveSessionHistoryService,
  ) {}

  private async assertVisible(tenantId: string | null, sessionId: string): Promise<string> {
    if (!tenantId) throw new NotFoundException('Session not found');
    // A hub entry exists only for this tenant's proxy traffic, but the
    // database is the authority: a session nobody can list stays hidden.
    if (!(await this.history.exists(tenantId, sessionId))) {
      throw new NotFoundException('Session not found');
    }
    return tenantId;
  }

  /** What each in-memory session of the organization ends with (the wall's session chips). */
  @Get('live-sessions/glance')
  glance(@TenantCtx() ctx: TenantContext) {
    return { items: ctx.tenantId ? this.hub.glance(ctx.tenantId) : [] };
  }

  @Get('sessions/:id/live')
  async live(
    @Param('id') id: string,
    @Query() query: LiveStreamQueryDto,
    @TenantCtx() ctx: TenantContext,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = await this.assertVisible(ctx.tenantId, id);
    if (!this.hub.acquireConnection(tenantId)) {
      throw new HttpException(
        `Too many live session windows open for this organization (limit ${LIVE_MAX_CONNECTIONS_PER_TENANT}). Close one and try again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.hub.releaseConnection(tenantId);
    };
    let cleanup = () => release();
    // `res` closes when the client goes away (a GET's `req` closes as soon as it is read).
    res.once('close', () => cleanup());

    try {
      const access = viewerAccess(ctx);
      const header = req.headers['last-event-id'];
      const rawLast = (Array.isArray(header) ? header[0] : header) ?? query.lastEventId;
      const lastEventId =
        rawLast && /^\d{1,16}$/.test(rawLast.trim()) ? Number(rawLast.trim()) : null;

      const existing = this.hub.find(tenantId, id);
      const meta = existing?.meta ?? (await this.history.meta(tenantId, id));
      const entry = this.hub.entryFor(tenantId, id, meta);
      const canReplay = this.hub.eventsAfter(entry, lastEventId) !== null;
      // The seed (what happened before the entry existed) needs the database;
      // read it before writing anything, then snapshot and subscribe in one
      // synchronous step so no event falls between them.
      const seed = canReplay
        ? null
        : await this.history.seedState(entry, access).catch((e: unknown) => {
            this.logger.warn(`Live session seed failed for ${id}: ${String(e)}`);
            return null;
          });
      if (released || res.destroyed) return;

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.flushHeaders();

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (!res.writableEnded) res.end();
      };
      const write = (chunk: string) => {
        if (closed) return;
        if (res.writableLength > LIVE_MAX_PENDING_BYTES) {
          // Too slow a client: drop it; the browser reconnects with Last-Event-ID.
          close();
          return;
        }
        res.write(chunk);
      };

      write('retry: 3000\n\n');
      // Re-read after the await so nothing emitted meanwhile is lost.
      const events = canReplay ? this.hub.eventsAfter(entry, lastEventId) : null;
      if (events) {
        for (const stored of events) write(this.hub.frame(stored, access));
      } else {
        const snapshot: LiveEvent = {
          id: entry.lastId,
          type: 'snapshot',
          ts: Date.now(),
          data: { session: entry.meta, state: this.hub.snapshotState(entry, access, seed) },
        };
        write(sseFrame(snapshot, JSON.stringify(snapshot)));
      }

      const subscriber: LiveSubscriber = { access, send: write, close };
      const unsubscribe = this.hub.subscribe(entry, subscriber);
      const heartbeat = setInterval(() => write(': hb\n\n'), LIVE_HEARTBEAT_MS);
      heartbeat.unref?.();
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        closed = true;
        release();
      };
      if (res.destroyed) cleanup();
    } catch (error) {
      cleanup();
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      throw error;
    }
  }

  @Get('sessions/:id/events')
  async events(
    @Param('id') id: string,
    @Query() query: LiveEventsQueryDto,
    @TenantCtx() ctx: TenantContext,
  ) {
    const tenantId = await this.assertVisible(ctx.tenantId, id);
    const limit = Math.min(
      Math.max(Number(query.limit ?? EVENTS_DEFAULT_LIMIT), 1),
      EVENTS_MAX_LIMIT,
    );
    return this.history.events(tenantId, id, viewerAccess(ctx), {
      after: query.after ? Number(query.after) : 0,
      until: query.until ? Number(query.until) : null,
      limit,
    });
  }
}
