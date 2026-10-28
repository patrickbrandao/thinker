import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SOURCE_HEADER,
  PEER_IP_HEADER,
  clientIpInfo,
} from '../utils/client-ip';
import { markRequestReceived } from '../utils/request-received';

const logger = new Logger('ClientIp');
const WARN_INTERVAL_MS = 60_000;
const lastWarned = new Map<string, number>();

/** Rate-limited: one warning per proxy address per minute. */
function warnMissingHeader(peer: string): void {
  const now = Date.now();
  if (now - (lastWarned.get(peer) ?? 0) < WARN_INTERVAL_MS) return;
  if (lastWarned.size > 1000) lastWarned.clear();
  lastWarned.set(peer, now);
  logger.warn(
    `Trusted proxy sent no X-Forwarded-For or X-Real-IP; using the TCP address. peer_ip=${peer}`,
  );
}

/**
 * First middleware of the app: resolves the client address once and makes
 * every later reader agree on it. `req.ip` (throttler, rate limits, guards)
 * becomes the resolved address, and the internal headers carry it to Better
 * Auth, which builds its own request from `req.headers`. Values a client sent
 * in those internal headers are overwritten.
 */
export function clientIpMiddleware(req: Request, _res: Response, next: NextFunction): void {
  markRequestReceived(req);
  const info = clientIpInfo(req, warnMissingHeader);
  Object.defineProperty(req, 'ip', { value: info.clientIp, configurable: true, enumerable: true });
  req.headers[CLIENT_IP_HEADER] = info.clientIp;
  req.headers[CLIENT_IP_SOURCE_HEADER] = info.source;
  req.headers[PEER_IP_HEADER] = info.peerIp;
  next();
}
