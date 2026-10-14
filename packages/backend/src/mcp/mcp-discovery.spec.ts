import express from 'express';
import request from 'supertest';
import { createServer, type RequestListener, type Server } from 'http';
import { mountMcpDiscovery, mountMcpUnavailable } from './mcp-discovery';

jest.mock('../auth/auth.instance', () => ({
  authInstance: {},
  authOrigin: 'http://localhost:2099',
  authIssuer: 'http://localhost:2099/api/auth',
  mcpResource: 'http://localhost:2099/api/v1/mcp',
  MCP_SCOPES: ['mcp:read', 'mcp:write'],
}));
jest.mock('@better-auth/oauth-provider', () => ({
  oauthProviderAuthServerMetadata: jest.fn(),
}));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: jest.fn(() => new Headers()) }));

const { oauthProviderAuthServerMetadata } = jest.requireMock('@better-auth/oauth-provider') as {
  oauthProviderAuthServerMetadata: jest.Mock;
};

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

function makeApp(): express.Express {
  const app = express();
  mountMcpDiscovery({
    getHttpAdapter: () => ({ getInstance: () => app }),
  } as never);
  return app;
}

describe('mountMcpDiscovery', () => {
  beforeEach(() => {
    oauthProviderAuthServerMetadata.mockReset();
    oauthProviderAuthServerMetadata.mockReturnValue(
      async () =>
        new Response(JSON.stringify({ issuer: 'http://localhost:2099/api/auth' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
  });

  it('serves the protected-resource metadata at both well-known forms', async () => {
    const server = await serveOnLoopback(makeApp());
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/v1/mcp',
    ]) {
      const res = await request(server).get(path).expect(200);
      expect(res.body).toMatchObject({
        resource: 'http://localhost:2099/api/v1/mcp',
        authorization_servers: ['http://localhost:2099/api/auth'],
        scopes_supported: ['mcp:read', 'mcp:write'],
      });
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
  });

  it('answers HEAD on the resource metadata', async () => {
    await request(await serveOnLoopback(makeApp()))
      .head('/.well-known/oauth-protected-resource')
      .expect(200);
  });

  it('advertises the canonical resource and issuer whatever the Host header', async () => {
    const res = await request(await serveOnLoopback(makeApp()))
      .get('/.well-known/oauth-protected-resource/api/v1/mcp')
      .set('Host', 'other.example')
      .expect(200);
    expect(res.body).toMatchObject({
      resource: 'http://localhost:2099/api/v1/mcp',
      authorization_servers: ['http://localhost:2099/api/auth'],
    });
  });

  it('proxies the authorization-server metadata at the path-suffixed well-known', async () => {
    const res = await request(await serveOnLoopback(makeApp()))
      .get('/.well-known/oauth-authorization-server/api/auth')
      .expect(200);
    expect(res.body).toMatchObject({ issuer: 'http://localhost:2099/api/auth' });
  });

  it('does not advertise registration that requires a signed-in user', async () => {
    oauthProviderAuthServerMetadata.mockReturnValue(
      async () =>
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:2099/api/auth',
            registration_endpoint: '/register',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const res = await request(await serveOnLoopback(makeApp()))
      .get('/.well-known/oauth-authorization-server/api/auth')
      .expect(200);
    expect(res.body).toEqual({ issuer: 'http://localhost:2099/api/auth' });
  });

  it('builds authorization metadata on the canonical origin, not the Host header', async () => {
    const serve = jest.fn(
      async (req: Request) =>
        new Response(JSON.stringify({ issuer: new URL(req.url).origin + '/api/auth' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    oauthProviderAuthServerMetadata.mockReturnValue(serve);
    const res = await request(await serveOnLoopback(makeApp()))
      .get('/.well-known/oauth-authorization-server/api/auth')
      .set('Host', 'other.example')
      .expect(200);
    expect(res.body.issuer).toBe('http://localhost:2099/api/auth');
    expect(serve.mock.calls[0][0].url).toBe(
      'http://localhost:2099/.well-known/oauth-authorization-server/api/auth',
    );
  });

  it('answers the origin root well-known with JSON, not the SPA shell', async () => {
    const res = await request(await serveOnLoopback(makeApp()))
      .get('/.well-known/oauth-authorization-server')
      .expect(404);
    expect(res.body).toMatchObject({ statusCode: 404 });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('answers 404 when the authorization-server metadata is unavailable', async () => {
    oauthProviderAuthServerMetadata.mockReturnValue(async () => {
      throw new Error('down');
    });
    await request(await serveOnLoopback(makeApp()))
      .get('/.well-known/oauth-authorization-server/api/auth')
      .expect(404);
  });
});

describe('mountMcpUnavailable', () => {
  function makeDisabledApp(): express.Express {
    const app = express();
    mountMcpUnavailable({
      getHttpAdapter: () => ({ getInstance: () => app }),
    } as never);
    return app;
  }

  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/api/auth',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/v1/mcp',
  ])('answers a JSON 404 at %s instead of falling through to the SPA', async (path) => {
    const res = await request(await serveOnLoopback(makeDisabledApp()))
      .get(path)
      .expect(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({ statusCode: 404, message: 'MCP is not enabled on this install' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('never builds the Better Auth metadata handler', () => {
    oauthProviderAuthServerMetadata.mockClear();
    makeDisabledApp();
    expect(oauthProviderAuthServerMetadata).not.toHaveBeenCalled();
  });
});
