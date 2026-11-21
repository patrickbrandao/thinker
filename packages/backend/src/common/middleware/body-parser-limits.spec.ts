import express, { Request, Response } from 'express';
import { EventEmitter } from 'events';
import request from 'supertest';
import { createServer, type RequestListener, type Server } from 'http';
import {
  API_BODY_LIMIT,
  PROXY_BODY_KEY_SHARE_BYTES,
  PROXY_BODY_LIMIT,
  PROXY_BODY_LIMIT_BYTES,
  PROXY_PRE_AUTH,
  bodyParserErrorHandler,
  createProxyBodyBudgetMiddleware,
  createProxyPreAuthMiddleware,
  proxyPreAuth,
  skipRefusedProxyBodies,
} from './body-parser-limits';

function createParserTestApp() {
  const app = express();
  app.use('/v1', createProxyBodyBudgetMiddleware());
  app.use('/v1', express.json({ limit: PROXY_BODY_LIMIT }));
  app.use(express.json({ limit: API_BODY_LIMIT }));
  app.use(bodyParserErrorHandler);
  app.post('/v1/chat/completions', (req: Request, res: Response) => {
    res.json({ contentLength: String(req.body.messages[0].content).length });
  });
  app.post('/api/v1/test', (req: Request, res: Response) => {
    res.json({ contentLength: String(req.body.messages[0].content).length });
  });
  return app;
}

// Hand supertest a server already listening on 127.0.0.1. Given an app that is
// not listening, supertest binds the wildcard address on every request and
// then dials 127.0.0.1, and on macOS that port can already belong to another
// local process's 127.0.0.1 listener, which then answers instead (#62).
const loopbackServers: Server[] = [];
async function serveOnLoopback(handler: RequestListener): Promise<Server> {
  const server = createServer(handler);
  loopbackServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
afterEach(async () => {
  await Promise.all(
    loopbackServers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

function createMockResponse() {
  const res = new EventEmitter() as express.Response & EventEmitter;
  res.status = jest.fn(() => res) as unknown as express.Response['status'];
  res.json = jest.fn(() => res) as unknown as express.Response['json'];
  return res;
}

describe('body parser limits', () => {
  it('allows OpenAI-compatible proxy bodies above the regular Thinker API limit', async () => {
    const content = 'x'.repeat(1024 * 1024 + 1);
    const payload = { messages: [{ role: 'user', content }] };

    await request(await serveOnLoopback(createParserTestApp()))
      .post('/v1/chat/completions')
      .send(payload)
      .expect(200);
    const apiRes = await request(await serveOnLoopback(createParserTestApp()))
      .post('/api/v1/test')
      .send(payload)
      .expect(413);

    expect(apiRes.body).toEqual({
      message: 'Request body is too large',
      error: 'Payload Too Large',
      statusCode: 413,
    });
  });

  it('returns JSON 400s for malformed proxy JSON', async () => {
    const res = await request(await serveOnLoopback(createParserTestApp()))
      .post('/v1/chat/completions')
      .set('Content-Type', 'application/json')
      .send('{"messages":')
      .expect(400);

    expect(res.body).toEqual({
      message: 'Invalid JSON request body',
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('limits the total Content-Length of proxy request bodies in flight', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const firstReq = {
      method: 'POST',
      headers: { 'content-length': String(PROXY_BODY_LIMIT_BYTES) },
    } as express.Request;
    const secondReq = {
      method: 'POST',
      headers: { 'content-length': '1' },
    } as express.Request;
    const firstRes = createMockResponse();
    const secondRes = createMockResponse();
    const firstNext = jest.fn();
    const secondNext = jest.fn();

    middleware(firstReq, firstRes, firstNext);
    middleware(secondReq, secondRes, secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.status).toHaveBeenCalledWith(429);
    expect(secondRes.json).toHaveBeenCalledWith({
      message: 'Too many large proxy requests in flight',
      error: 'Too Many Requests',
      statusCode: 429,
    });

    firstRes.emit('finish');
    const thirdNext = jest.fn();
    middleware(secondReq, createMockResponse(), thirdNext);
    expect(thirdNext).toHaveBeenCalledTimes(1);
  });

  it('skips body budgets for requests without proxy bodies', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const next = jest.fn();

    middleware({ method: 'GET', headers: {} } as express.Request, createMockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows proxy request bodies without Content-Length when they are not chunked', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const next = jest.fn();

    middleware({ method: 'POST', headers: {} } as express.Request, createMockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects chunked proxy request bodies without a Content-Length budget', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const res = createMockResponse();
    const next = jest.fn();

    middleware(
      {
        method: 'POST',
        headers: { 'transfer-encoding': 'chunked' },
      } as express.Request,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(411);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Content-Length is required for proxy request bodies',
      error: 'Length Required',
      statusCode: 411,
    });
  });

  it('rejects invalid proxy Content-Length headers', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const res = createMockResponse();
    const next = jest.fn();

    middleware(
      {
        method: 'POST',
        headers: { 'content-length': '-1' },
      } as express.Request,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid Content-Length header',
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('rejects proxy request bodies above the proxy limit before parsing', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const res = createMockResponse();
    const next = jest.fn();

    middleware(
      {
        method: 'POST',
        headers: { 'content-length': String(PROXY_BODY_LIMIT_BYTES + 1) },
      } as express.Request,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      message: `Request body exceeds ${PROXY_BODY_LIMIT}`,
      error: 'Payload Too Large',
      statusCode: 413,
    });
  });

  it('passes through non-body-parser errors', () => {
    const res = createMockResponse();
    const next = jest.fn();
    const err = new Error('boom');

    bodyParserErrorHandler(err, {} as express.Request, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through unsupported body-parser errors', () => {
    const res = createMockResponse();
    const next = jest.fn();
    const err = Object.assign(new Error('unsupported parser error'), {
      type: 'entity.verify.failed',
    });

    bodyParserErrorHandler(err, {} as express.Request, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('proxy bodies are read only after the agent key is accepted', () => {
  function preAuthApp(authenticate: (req: express.Request) => Promise<boolean>) {
    const seen: Array<{ body: unknown }> = [];
    const app = express();
    app.use('/v1', createProxyPreAuthMiddleware(authenticate));
    app.use('/v1', createProxyBodyBudgetMiddleware());
    app.use('/v1', skipRefusedProxyBodies(express.json({ limit: PROXY_BODY_LIMIT })));
    app.use(skipRefusedProxyBodies(express.json({ limit: API_BODY_LIMIT })));
    app.use(bodyParserErrorHandler);
    app.post('/v1/chat/completions', (req: Request, res: Response) => {
      seen.push({ body: req.body });
      const pre = proxyPreAuth(req);
      res.status(pre?.ok === false ? 401 : 200).json({ ok: pre?.ok ?? null });
    });
    return { app, seen };
  }

  it('never parses the body of a refused key, and the route still answers', async () => {
    const { app, seen } = preAuthApp(async () => {
      throw new Error('Invalid API key');
    });
    await request(await serveOnLoopback(app))
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] })
      .expect(401);
    expect(seen).toEqual([{ body: undefined }]);
  });

  it('parses the body of an accepted key', async () => {
    const { app, seen } = preAuthApp(async () => true);
    await request(await serveOnLoopback(app))
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(200);
    expect(seen[0]!.body).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('does not authenticate bodyless requests ahead of the guard', async () => {
    const authenticate = jest.fn(async () => true);
    const middleware = createProxyPreAuthMiddleware(authenticate);
    const next = jest.fn();
    middleware({ method: 'GET', headers: {} } as express.Request, createMockResponse(), next);
    expect(authenticate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('a refused key reserves no budget: a full-size claim leaves room for others', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const refused = {
      method: 'POST',
      headers: { 'content-length': String(PROXY_BODY_LIMIT_BYTES) },
      [PROXY_PRE_AUTH]: { ok: false, error: new Error('Invalid API key') },
    } as unknown as express.Request;
    const accepted = {
      method: 'POST',
      headers: { 'content-length': '1' },
      [PROXY_PRE_AUTH]: { ok: true },
    } as unknown as express.Request;
    const refusedNext = jest.fn();
    const acceptedNext = jest.fn();
    middleware(refused, createMockResponse(), refusedNext);
    middleware(accepted, createMockResponse(), acceptedNext);
    expect(refusedNext).toHaveBeenCalledTimes(1);
    expect(acceptedNext).toHaveBeenCalledTimes(1);
  });

  it('caps what one key holds in flight once it already has a request open', () => {
    const middleware = createProxyBodyBudgetMiddleware();
    const fromKey = (keyId: string, bytes: number) =>
      ({
        method: 'POST',
        headers: { 'content-length': String(bytes) },
        ingestionContext: { keyId, agentId: 'a1' },
      }) as unknown as express.Request;
    const big = PROXY_BODY_KEY_SHARE_BYTES;
    const firstRes = createMockResponse();
    const first = jest.fn();
    middleware(fromKey('k1', big), firstRes, first);
    expect(first).toHaveBeenCalledTimes(1);

    const sameKeyRes = createMockResponse();
    const sameKey = jest.fn();
    middleware(fromKey('k1', 1), sameKeyRes, sameKey);
    expect(sameKey).not.toHaveBeenCalled();
    expect(sameKeyRes.status).toHaveBeenCalledWith(429);

    const otherKey = jest.fn();
    middleware(fromKey('k2', 1), createMockResponse(), otherKey);
    expect(otherKey).toHaveBeenCalledTimes(1);

    firstRes.emit('close');
    const afterRelease = jest.fn();
    middleware(fromKey('k1', 1), createMockResponse(), afterRelease);
    expect(afterRelease).toHaveBeenCalledTimes(1);
  });
});
