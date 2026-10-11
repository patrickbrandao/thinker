import { Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import {
  applyPrivateNetworkAllow,
  buildCorsOptions,
  buildDevAllowedOrigins,
  buildProdAllowedOrigins,
} from '../src/cors-csp-config';
import { listenOnLoopback } from './loopback';

/** An origin an operator opts in with THINKER_CORS_ORIGINS. */
const OPERATOR_ORIGIN = 'https://tools.acme.dev';
/** The hosted gateway tester upstream allowed by default; Thinker must not (#17). */
const FORMER_HOSTED_ORIGIN = ['https://wingman', 'manifest', 'build'].join('.');

@Controller()
class CorsTestController {
  @Get('/api/v1/health')
  health() {
    return { status: 'healthy' };
  }

  @Post('/v1/chat/completions')
  chat() {
    return { ok: true };
  }
}

@Module({ controllers: [CorsTestController] })
class CorsTestModule {}

async function buildApp(allowedOrigins: string[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [CorsTestModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use((req: Request, res: Response, next: NextFunction) => {
    applyPrivateNetworkAllow(req, allowedOrigins, (name, value) => res.setHeader(name, value));
    next();
  });
  app.enableCors(buildCorsOptions(allowedOrigins));
  await listenOnLoopback(app);
  return app;
}

// The exact inputs main.ts uses in dev: the dev allow-list, the PNA middleware,
// and the shared CORS options (header reflection + preflight maxAge).
function buildDevApp(extraOrigins?: string): Promise<INestApplication> {
  return buildApp(
    buildDevAllowedOrigins({ configuredOrigin: 'http://localhost:3000', extraOrigins }),
  );
}

// The exact CORS config main.ts uses in production: only THINKER_CORS_ORIGINS
// opt-ins, the PNA middleware, and the shared CORS options.
function buildProdApp(extraOrigins?: string): Promise<INestApplication> {
  return buildApp(buildProdAllowedOrigins({ extraOrigins }));
}

describe('CORS — development', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildDevApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows the configured Vite frontend origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it.each([FORMER_HOSTED_ORIGIN, 'http://localhost:3002', 'https://evil.example.com'])(
    'rejects %s (no Allow-Origin header echoed)',
    async (origin) => {
      const res = await request(app.getHttpServer())
        .options('/v1/chat/completions')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('does not echo Access-Control-Allow-Credentials (no cookies cross-origin)', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('echoes Access-Control-Allow-Private-Network for PNA preflight from a listed origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('does not echo Allow-Private-Network when the request header is missing', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });

  it('caches the preflight (maxAge) so a reload does not re-run it every few seconds', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-max-age']).toBe('7200');
  });

  it('allows a THINKER_CORS_ORIGINS opt-in in dev too', async () => {
    const scoped = await buildDevApp(OPERATOR_ORIGIN);
    try {
      const res = await request(scoped.getHttpServer())
        .options('/v1/chat/completions')
        .set('Origin', OPERATOR_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBe(OPERATOR_ORIGIN);
    } finally {
      await scoped.close();
    }
  });
});

describe('CORS — production, default', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildProdApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([FORMER_HOSTED_ORIGIN, 'https://evil.example.com', 'http://localhost:3000'])(
    'allows no cross-origin caller: rejects %s',
    async (origin) => {
      const preflight = await request(app.getHttpServer())
        .options('/v1/chat/completions')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Private-Network', 'true');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      expect(preflight.headers['access-control-allow-private-network']).toBeUndefined();

      const post = await request(app.getHttpServer())
        .post('/v1/chat/completions')
        .set('Origin', origin)
        .send({ model: 'auto' });
      expect(post.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('still serves same-origin and non-browser callers (no Origin header)', async () => {
    const res = await request(app.getHttpServer()).post('/v1/chat/completions').send({});
    expect(res.status).toBe(201);
  });
});

describe('CORS — production, THINKER_CORS_ORIGINS', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildProdApp(`${OPERATOR_ORIGIN}/`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows the preflight from an operator-configured origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/chat/completions')
      .set('Origin', OPERATOR_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe(OPERATOR_ORIGIN);
  });

  it('reflects the SDK fingerprint headers on the preflight (X-Stainless-*)', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/chat/completions')
      .set('Origin', OPERATOR_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'authorization,content-type,x-stainless-lang,x-stainless-runtime',
      );
    const allowHeaders = (res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(allowHeaders).toContain('authorization');
    expect(allowHeaders).toContain('content-type');
    expect(allowHeaders).toContain('x-stainless-lang');
    expect(allowHeaders).toContain('x-stainless-runtime');
  });

  it('echoes Allow-Origin on the actual POST, not just the preflight', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Origin', OPERATOR_ORIGIN)
      .send({ model: 'auto' });
    expect(res.headers['access-control-allow-origin']).toBe(OPERATOR_ORIGIN);
  });

  it('does not echo Access-Control-Allow-Credentials (no cookies cross-origin)', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/chat/completions')
      .set('Origin', OPERATOR_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers the Private Network Access preflight for an allow-listed origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/chat/completions')
      .set('Origin', OPERATOR_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('caches the preflight (maxAge)', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/chat/completions')
      .set('Origin', OPERATOR_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-max-age']).toBe('7200');
  });

  it('still rejects origins the operator did not list', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/chat/completions')
      .set('Origin', FORMER_HOSTED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
