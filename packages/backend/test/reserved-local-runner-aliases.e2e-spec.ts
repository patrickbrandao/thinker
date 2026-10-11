import { json } from 'express';
import { INestApplication } from '@nestjs/common';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  API_BODY_LIMIT,
  PROXY_BODY_LIMIT,
  createProxyBodyBudgetMiddleware,
} from '../src/common/middleware/body-parser-limits';
import { ReserveLocalRunnerAliases1803200000000 } from '../src/database/migrations/1803200000000-ReserveLocalRunnerAliases';
import { ProviderModelFetcherService } from '../src/model-discovery/provider-model-fetcher.service';
import { RoutingCacheService } from '../src/routing/routing-core/routing-cache.service';
import { createTestApp, TEST_API_KEY } from './helpers';
import { closeServer, serveOnLoopback } from './loopback';

type Json = Record<string, any>;

interface MockServer {
  server: Server;
  received: Array<{ url: string; body: Json | null }>;
}

/** An OpenAI-compatible server on 127.0.0.1 that answers with its own name. */
async function startServer(name: string, models: string[]): Promise<MockServer> {
  const received: MockServer['received'] = [];
  const server = await serveOnLoopback(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? (JSON.parse(raw) as Json) : null;
    received.push({ url: req.url ?? '', body });

    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id })) }));
      return;
    }
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: body?.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: `Hello from ${name}` },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
      }),
    );
  });
  return { server, received };
}

function rootUrl(mock: MockServer): string {
  return `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
}

// Issue #101: a custom provider holding the alias `lmstudio` published the
// same ids as the built-in LM Studio connection.
describe('Reserved local runner aliases (e2e)', () => {
  const ENV_KEYS = ['MANIFEST_MODE', 'THINKER_LMSTUDIO_BASE_URL'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const agentName = 'alias-e2e';
  const headers = { 'x-api-key': TEST_API_KEY };
  let app: INestApplication;
  let native: MockServer;
  let secondBox: MockServer;
  let agentKey: string;
  let tenantId: string;

  const chat = (model: string) =>
    request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${agentKey}`)
      .send({ model, messages: [{ role: 'user', content: 'Hi' }] });

  const modelIds = async (): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${agentKey}`)
      .expect(200);
    return (res.body.data as Json[]).map((m) => m.id as string);
  };

  beforeAll(async () => {
    native = await startServer('native', ['qwen/qwen3-8b']);
    secondBox = await startServer('second-box', ['qwen/qwen3-8b', 'mistral-7b']);
    process.env['MANIFEST_MODE'] = 'selfhosted';
    process.env['THINKER_LMSTUDIO_BASE_URL'] = rootUrl(native);

    app = await createTestApp({
      configureApp: (nestApp) => {
        nestApp.use('/v1', createProxyBodyBudgetMiddleware(), json({ limit: PROXY_BODY_LIMIT }));
        nestApp.use(json({ limit: API_BODY_LIMIT }));
      },
    });
    // Real discovery, which only ever reaches the loopback mock above.
    const realFetcher = new ProviderModelFetcherService();
    const stub = app.get(ProviderModelFetcherService) as { fetch: unknown };
    stub.fetch = realFetcher.fetch.bind(realFetcher);

    const created = await request(app.getHttpServer())
      .post('/api/v1/agents')
      .set(headers)
      .send({ name: 'Alias E2E', agent_category: 'coding', autofix_enabled: false })
      .expect(201);
    agentKey = created.body.apiKey;
    const [agent] = await app
      .get(DataSource)
      .query(`SELECT tenant_id FROM agents WHERE id = $1`, [created.body.agent.id]);
    tenantId = agent.tenant_id;
  }, 30000);

  beforeEach(() => {
    native.received.length = 0;
    secondBox.received.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    if (native) await closeServer(native.server);
    if (secondBox) await closeServer(secondBox.server);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('new custom providers', () => {
    it.each(['lmstudio', 'llamacpp', 'ollama'])(
      'rejects %s as an explicit alias with 400',
      async (alias) => {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/routing/${agentName}/custom-providers`)
          .set(headers)
          .send({
            name: `Box for ${alias}`,
            alias,
            base_url: 'http://127.0.0.1:9/v1',
            models: [{ model_name: 'x' }],
          })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain('reserved');
      },
    );

    it('gives a provider named "LMStudio" no default alias instead of lmstudio', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({
          name: 'LMStudio',
          base_url: 'http://127.0.0.1:9/v1',
          models: [{ model_name: 'x' }],
        })
        .expect(201);
      expect(res.body.alias).toBeNull();

      await request(app.getHttpServer())
        .put(`/api/v1/routing/${agentName}/custom-providers/${res.body.id}`)
        .set(headers)
        .send({ alias: 'lmstudio' })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/api/v1/routing/${agentName}/custom-providers/${res.body.id}`)
        .set(headers)
        .expect(200);
    });
  });

  describe('a custom provider that already held lmstudio', () => {
    let customId: string;

    beforeAll(async () => {
      // Created under a free alias, then given `lmstudio` straight in the
      // database: the state an install had before the alias was reserved.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({
          name: 'Second Box',
          alias: 'second-box',
          base_url: `${rootUrl(secondBox)}/v1`,
          models: [{ model_name: 'qwen/qwen3-8b' }, { model_name: 'mistral-7b' }],
        })
        .expect(201);
      customId = res.body.id;

      const ds = app.get(DataSource);
      await ds.query(`UPDATE custom_providers SET alias = 'lmstudio' WHERE id = $1`, [customId]);
      const qr = ds.createQueryRunner();
      try {
        await new ReserveLocalRunnerAliases1803200000000().up(qr);
      } finally {
        await qr.release();
      }

      await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/providers`)
        .set(headers)
        .send({ provider: 'lmstudio', authType: 'local' })
        .expect(201);
      app.get(RoutingCacheService).invalidateTenant(tenantId);
    }, 30000);

    it('is moved to lmstudio-custom, keeping the old alias', async () => {
      const [row] = await app
        .get(DataSource)
        .query(`SELECT alias, legacy_alias FROM custom_providers WHERE id = $1`, [customId]);
      expect(row).toEqual({ alias: 'lmstudio-custom', legacy_alias: 'lmstudio' });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .expect(200);
      const listed = (res.body as Json[]).find((cp) => cp.id === customId);
      expect(listed?.alias).toBe('lmstudio-custom');
    });

    it('lists every model id once, the built-in under lmstudio/ and the custom one under its new alias', async () => {
      const ids = await modelIds();
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => id === 'lmstudio/qwen/qwen3-8b')).toHaveLength(1);
      expect(ids).toEqual(
        expect.arrayContaining(['lmstudio-custom/qwen/qwen3-8b', 'lmstudio-custom/mistral-7b']),
      );
      expect(ids).not.toContain('lmstudio/mistral-7b');
    });

    it('routes lmstudio/<model> to the built-in server when it serves the model', async () => {
      const res = await chat('lmstudio/qwen/qwen3-8b').expect(200);
      expect(res.body.choices[0].message.content).toBe('Hello from native');
      expect(secondBox.received).toHaveLength(0);
      expect(native.received.at(-1)?.body).toMatchObject({ model: 'qwen/qwen3-8b' });
    });

    it('keeps routing an old lmstudio/<model> config to the custom provider for its own models', async () => {
      const res = await chat('lmstudio/mistral-7b').expect(200);
      expect(res.body.choices[0].message.content).toBe('Hello from second-box');
      expect(native.received.filter((r) => r.url === '/v1/chat/completions')).toHaveLength(0);
      expect(secondBox.received.at(-1)?.body).toMatchObject({ model: 'mistral-7b' });
    });

    it('routes the new alias and the internal key to the custom provider', async () => {
      for (const model of ['lmstudio-custom/qwen/qwen3-8b', `custom:${customId}/qwen/qwen3-8b`]) {
        const res = await chat(model).expect(200);
        expect(res.body.choices[0].message.content).toBe('Hello from second-box');
      }
      expect(native.received.filter((r) => r.url === '/v1/chat/completions')).toHaveLength(0);
    });
  });
});

/**
 * Runs the real migration chain (synchronize: false), so the rename and its
 * revert execute against the schema production has, unique index included.
 */
describe('ReserveLocalRunnerAliases under the migration-built schema (e2e)', () => {
  let ds: DataSource;

  const insert = (id: string, tenant: string, name: string, alias: string | null) =>
    ds.query(
      `INSERT INTO "custom_providers" ("id","tenant_id","name","alias","base_url","api_kind","models","created_at")
       VALUES ($1,$2,$3,$4,'http://127.0.0.1:9/v1','openai','[]', now())`,
      [id, tenant, name, alias],
    );

  const aliases = async () => {
    const rows: { id: string; alias: string | null; legacy_alias?: string | null }[] =
      await ds.query(`SELECT * FROM "custom_providers" ORDER BY "id"`);
    return Object.fromEntries(
      rows.map((r) => [r.id, 'legacy_alias' in r ? [r.alias, r.legacy_alias] : [r.alias]]),
    );
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: process.env['DATABASE_URL'],
      entities: ['src/entities/!(*.spec).ts'],
      migrations: ['src/database/migrations/!(*.spec).ts'],
      synchronize: false,
      dropSchema: true,
      logging: false,
    });
    await ds.initialize();
    await ds.runMigrations({ transaction: 'each' });
    // Step back to the schema right before this migration and seed the
    // aliases an older install could hold.
    await ds.undoLastMigration({ transaction: 'each' });
    const [last] = await ds.query(`SELECT name FROM migrations ORDER BY id DESC LIMIT 1`);
    expect(last.name).not.toBe('ReserveLocalRunnerAliases1803200000000');

    await ds.query(`DELETE FROM "custom_providers"`);
    await insert('cp-1', 't-1', 'LMStudio', 'lmstudio');
    await insert('cp-2', 't-1', 'llamacpp', 'llamacpp');
    await insert('cp-3', 't-1', 'Taken', 'lmstudio-custom');
    await insert('cp-4', 't-1', 'LM Studio', 'lm-studio');
    await insert('cp-5', 't-2', 'LMStudio', 'LMStudio');
    await insert('cp-6', 't-2', 'Plain', null);
  }, 60000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('renames reserved aliases per tenant and keeps the old one', async () => {
    await ds.runMigrations({ transaction: 'each' });
    expect(await aliases()).toEqual({
      'cp-1': ['lmstudio-custom-2', 'lmstudio'],
      'cp-2': ['llamacpp-custom', 'llamacpp'],
      'cp-3': ['lmstudio-custom', null],
      'cp-4': ['lm-studio', null],
      'cp-5': ['lmstudio-custom', 'LMStudio'],
      'cp-6': [null, null],
    });
  });

  it('keeps the tenant alias unique index enforced', async () => {
    await expect(insert('cp-7', 't-1', 'Dup', 'LMSTUDIO-CUSTOM-2')).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    );
  });

  it('restores the old aliases on revert, skipping one taken in the meantime', async () => {
    // Another provider of t-2 grabbed the old alias after the upgrade.
    await insert('cp-8', 't-2', 'Later', 'lmstudio');
    await ds.undoLastMigration({ transaction: 'each' });
    expect(await aliases()).toEqual({
      'cp-1': ['lmstudio'],
      'cp-2': ['llamacpp'],
      'cp-3': ['lmstudio-custom'],
      'cp-4': ['lm-studio'],
      'cp-5': ['lmstudio-custom'],
      'cp-6': [null],
      'cp-8': ['lmstudio'],
    });
  });

  it('is a no-op the second time once nothing holds a reserved alias', async () => {
    await ds.query(`DELETE FROM "custom_providers" WHERE "id" IN ('cp-1','cp-2','cp-8')`);
    await ds.runMigrations({ transaction: 'each' });
    expect(await aliases()).toEqual({
      'cp-3': ['lmstudio-custom', null],
      'cp-4': ['lm-studio', null],
      'cp-5': ['lmstudio-custom', null],
      'cp-6': [null, null],
    });
  });
});
