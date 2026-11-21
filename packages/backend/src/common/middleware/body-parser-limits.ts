import * as express from 'express';

export const API_BODY_LIMIT = '1mb';
export const PROXY_BODY_LIMIT = '512mb';
export const PROXY_BODY_LIMIT_BYTES = 512 * 1024 * 1024;
/**
 * In-flight proxy body bytes one key may hold once it already has a request
 * in flight. A single request may still use the whole budget.
 */
export const PROXY_BODY_KEY_SHARE_BYTES = PROXY_BODY_LIMIT_BYTES / 4;

const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Outcome of authenticating a proxy request from its headers, before its body
 * is read. Set only by createProxyPreAuthMiddleware (a symbol: no client can
 * forge it) and read back by the agent-key guard, so the key is checked once.
 */
export const PROXY_PRE_AUTH = Symbol('thinker.proxyPreAuth');
export type ProxyPreAuth = { ok: true } | { ok: false; error: unknown };
type WithPreAuth = { [PROXY_PRE_AUTH]?: ProxyPreAuth };

export function proxyPreAuth(req: object): ProxyPreAuth | undefined {
  return (req as WithPreAuth)[PROXY_PRE_AUTH];
}

/**
 * Authenticates `/v1` requests that carry a body before anything reads it, so
 * a caller without a valid key never reserves the shared body budget nor gets
 * its body buffered and parsed. A refused request goes on with no body; the
 * guard then answers it with the same error it always did.
 */
export function createProxyPreAuthMiddleware(
  authenticate: (req: express.Request) => Promise<boolean>,
): express.RequestHandler {
  return (req, _res, next) => {
    if (BODYLESS_METHODS.has(req.method)) {
      next();
      return;
    }
    const holder = req as WithPreAuth;
    const refuse = (error: unknown) => {
      holder[PROXY_PRE_AUTH] = { ok: false, error };
      // Discard the body as it arrives (nothing is buffered nor counted in the
      // budget) and answer once it is in, so the client reads the guard's
      // error instead of a connection reset halfway through its upload.
      let resumed = false;
      const proceed = () => {
        if (resumed) return;
        resumed = true;
        next();
      };
      if (req.readableEnded) {
        proceed();
        return;
      }
      req.once('end', proceed);
      req.once('close', proceed);
      req.resume();
    };
    authenticate(req).then((ok) => {
      if (ok) {
        holder[PROXY_PRE_AUTH] = { ok: true };
        next();
      } else {
        refuse(new Error('Agent key authentication failed'));
      }
    }, refuse);
  };
}

/** Wraps a body parser so it never reads the body of a refused proxy request. */
export function skipRefusedProxyBodies(parser: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    if (proxyPreAuth(req)?.ok === false) {
      next();
      return;
    }
    parser(req, res, next);
  };
}

function budgetOwner(req: express.Request): string | undefined {
  const ctx = (req as express.Request & { ingestionContext?: { keyId?: string; agentId?: string } })
    .ingestionContext;
  return ctx?.keyId ?? ctx?.agentId;
}

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  if (!(err instanceof Error)) return false;
  const maybe = err as BodyParserError;
  return typeof maybe.type === 'string' || maybe.status === 413 || maybe.statusCode === 413;
}

export function createProxyBodyBudgetMiddleware(): express.RequestHandler {
  let activeBytes = 0;
  const activeByOwner = new Map<string, number>();

  return (req, res, next) => {
    if (BODYLESS_METHODS.has(req.method)) {
      next();
      return;
    }
    // A refused credential never reads its body, so it takes no budget.
    if (proxyPreAuth(req)?.ok === false) {
      next();
      return;
    }

    const rawLength = req.headers['content-length'];
    const contentLength = Array.isArray(rawLength) ? rawLength[0] : rawLength;
    if (!contentLength) {
      const rawTransferEncoding = req.headers['transfer-encoding'];
      const transferEncoding = Array.isArray(rawTransferEncoding)
        ? rawTransferEncoding.join(',')
        : rawTransferEncoding;
      if (transferEncoding?.toLowerCase().includes('chunked')) {
        res.status(411).json({
          message: 'Content-Length is required for proxy request bodies',
          error: 'Length Required',
          statusCode: 411,
        });
        return;
      }
      next();
      return;
    }

    const bodyBytes = Number.parseInt(contentLength, 10);
    if (!Number.isFinite(bodyBytes) || bodyBytes < 0) {
      res.status(400).json({
        message: 'Invalid Content-Length header',
        error: 'Bad Request',
        statusCode: 400,
      });
      return;
    }

    if (bodyBytes > PROXY_BODY_LIMIT_BYTES) {
      res.status(413).json({
        message: `Request body exceeds ${PROXY_BODY_LIMIT}`,
        error: 'Payload Too Large',
        statusCode: 413,
      });
      return;
    }

    const owner = budgetOwner(req);
    const ownerBytes = owner ? (activeByOwner.get(owner) ?? 0) : 0;
    if (
      activeBytes + bodyBytes > PROXY_BODY_LIMIT_BYTES ||
      (ownerBytes > 0 && ownerBytes + bodyBytes > PROXY_BODY_KEY_SHARE_BYTES)
    ) {
      res.status(429).json({
        message: 'Too many large proxy requests in flight',
        error: 'Too Many Requests',
        statusCode: 429,
      });
      return;
    }

    activeBytes += bodyBytes;
    if (owner) activeByOwner.set(owner, ownerBytes + bodyBytes);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeBytes = Math.max(0, activeBytes - bodyBytes);
      if (owner) {
        const left = (activeByOwner.get(owner) ?? 0) - bodyBytes;
        if (left > 0) activeByOwner.set(owner, left);
        else activeByOwner.delete(owner);
      }
    };

    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

export function bodyParserErrorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!isBodyParserError(err)) {
    next(err);
    return;
  }

  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    res.status(413).json({
      message: 'Request body is too large',
      error: 'Payload Too Large',
      statusCode: 413,
    });
    return;
  }

  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    res.status(400).json({
      message: 'Invalid JSON request body',
      error: 'Bad Request',
      statusCode: 400,
    });
    return;
  }

  next(err);
}
