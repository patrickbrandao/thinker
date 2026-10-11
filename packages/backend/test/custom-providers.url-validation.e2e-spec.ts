import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, TEST_API_KEY } from './helpers';

// URL-validation boundary tests for the custom-providers HTTP surface.
//
// The DTO uses class-validator's `IsUrl({ require_tld: false,
// require_protocol: true })` so malformed inputs and schemeless hostnames
// are rejected at the ValidationPipe layer (HTTP 400) before the service
// runs. The service then calls `validatePublicUrl()` for SSRF/HTTPS-only
// checks. `createTestApp()` boots with `NODE_ENV=test`, which makes
// `validatePublicUrl()` short-circuit unless `SKIP_SSRF_VALIDATION=false`
// is set per-request — the validator reads the env at call time (not boot)
// so tests flip it just-in-time.

describe('Custom Providers URL validation (e2e)', () => {
  let app: INestApplication;
  const agentName = 'test-agent';
  const headers = { 'x-api-key': TEST_API_KEY };
  const baseModels = [{ model_name: 'm1' }];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  // Per-test cleanup keeps the (agent_id, name) unique constraint clear.
  async function deleteByName(name: string): Promise<void> {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/routing/${agentName}/custom-providers`)
      .set(headers);
    const match = list.body.find((p: { name: string; id: string }) => p.name === name);
    if (match) {
      await request(app.getHttpServer())
        .delete(`/api/v1/routing/${agentName}/custom-providers/${match.id}`)
        .set(headers);
    }
  }

  function messagesOf(body: unknown): string[] {
    const m = (body as { message?: string | string[] }).message;
    if (Array.isArray(m)) return m.filter((x): x is string => typeof x === 'string');
    return typeof m === 'string' ? [m] : [];
  }

  describe('POST — malformed input rejected by ValidationPipe', () => {
    it('rejects a plain string with no scheme or host as 400', async () => {
      // IsUrl(require_protocol:true) demands a real scheme — "not-a-url"
      // has no scheme, no host, no path, so the DTO never reaches service.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'Malformed1', base_url: 'not-a-url', models: baseModels })
        .expect(400);

      // Pin the DTO's "Must be a valid URL" message so the rejection is
      // base_url-specific and not e.g. a missing-name false positive.
      expect(messagesOf(res.body).some((m) => m.includes('valid URL'))).toBe(true);
    });

    it('rejects host:port without a scheme as 400 (require_protocol)', async () => {
      // "localhost:9000" looks like a URL to humans but validator.js
      // rejects it without an http(s):// prefix.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'NoScheme', base_url: 'localhost:9000', models: baseModels })
        .expect(400);

      expect(messagesOf(res.body).some((m) => m.includes('valid URL'))).toBe(true);
    });

    it('rejects an empty base_url as 400', async () => {
      // Caught by IsNotEmpty before IsUrl. Explicit assertion catches a
      // regression where "" silently becomes a default value.
      await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'EmptyUrl', base_url: '', models: baseModels })
        .expect(400);
    });
  });

  describe('POST — dev/local URLs allowed in test mode', () => {
    afterEach(async () => {
      await deleteByName('Dev Localhost');
      await deleteByName('Long Path');
    });

    it('accepts http://localhost:9000 with explicit scheme', async () => {
      // Local LLM servers (Ollama, LM Studio, vLLM, llama.cpp) all bind
      // to localhost. NODE_ENV=test skips SSRF here; the real validator
      // allows it too (see the SSRF guard block below).
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'Dev Localhost', base_url: 'http://localhost:9000/v1', models: baseModels })
        .expect(201);

      expect(res.body.base_url).toBe('http://localhost:9000/v1');
    });

    it('accepts a long but valid URL (>200 chars, no MaxLength on DTO)', async () => {
      // The DTO has no MaxLength on base_url. Pin that a long valid URL
      // (well past the 64-char string in the finding) still lands at 201,
      // guarding against a regression that clips long-but-legal URLs.
      const longPath = 'x'.repeat(200);
      const longUrl = `https://api.example.com/v1/${longPath}`;
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'Long Path', base_url: longUrl, models: baseModels })
        .expect(201);

      expect(res.body.base_url).toBe(longUrl);
    });
  });

  describe('POST — service-layer SSRF guard (single self-hosted mode)', () => {
    // Flip SKIP_SSRF_VALIDATION per-test so the NODE_ENV=test short-circuit is
    // bypassed and the real validator runs. No deployment-mode variable is set:
    // Thinker has one mode, and LAN/local destinations are a feature (local
    // models), while cloud metadata endpoints stay blocked. Hosts are literals
    // or reserved names so the outcome never depends on the runner's DNS.
    let originalSkip: string | undefined;

    beforeEach(() => {
      originalSkip = process.env['SKIP_SSRF_VALIDATION'];
      process.env['SKIP_SSRF_VALIDATION'] = 'false';
    });

    afterEach(async () => {
      if (originalSkip === undefined) delete process.env['SKIP_SSRF_VALIDATION'];
      else process.env['SKIP_SSRF_VALIDATION'] = originalSkip;
      await deleteByName('LAN Ollama');
      await deleteByName('Loopback');
    });

    it.each([
      ['LAN Ollama', 'http://192.168.1.50:11434/v1'],
      ['LAN Ollama', 'http://10.0.0.5:8000/v1'],
      ['Loopback', 'http://127.0.0.1:1234/v1'],
      ['Loopback', 'http://[::1]:8080/v1'],
    ])('accepts a LAN or loopback URL (%s: %s) with no mode configured', async (name, url) => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name, base_url: url, models: baseModels })
        .expect(201);

      expect(res.body.base_url).toBe(url);
      await deleteByName(name);
    });

    it('rejects plaintext http:// to a public host as 400', async () => {
      // AC-2 in the Mine paper: forwarding API keys + completions over http
      // to a public host leaks credentials to passive wire-sniffers.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'Plaintext HTTP', base_url: 'http://93.184.216.34/v1', models: baseModels })
        .expect(400);

      const body = res.body as { message?: string };
      expect(body.message).toContain('http:// is only allowed for private hosts');
    });

    it.each([
      'http://169.254.169.254/latest/meta-data',
      'https://169.254.169.254/latest/meta-data',
      'http://[fd00:ec2::254]/latest/meta-data',
      'http://[::ffff:169.254.169.254]/latest/meta-data',
      'http://100.100.100.200/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1/',
    ])('rejects the cloud metadata endpoint %s as 400', async (url) => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({ name: 'IMDS', base_url: url, models: baseModels })
        .expect(400);

      const body = res.body as { message?: string };
      expect(body.message).toContain('cloud metadata');
    });
  });

  describe('PUT — same URL rules on update', () => {
    let createdId: string;

    beforeEach(async () => {
      // Fresh row per test so a 400 update doesn't poison the next test.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/routing/${agentName}/custom-providers`)
        .set(headers)
        .send({
          name: 'Update Target',
          base_url: 'https://api.example.com/v1',
          models: baseModels,
        })
        .expect(201);
      createdId = res.body.id;
    });

    afterEach(async () => {
      await deleteByName('Update Target');
    });

    it('rejects a malformed base_url on update as 400', async () => {
      // Same DTO rules as POST — IsUrl fires on update too.
      await request(app.getHttpServer())
        .put(`/api/v1/routing/${agentName}/custom-providers/${createdId}`)
        .set(headers)
        .send({ base_url: 'not-a-url' })
        .expect(400);
    });

    it('rejects schemeless host:port on update as 400', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/routing/${agentName}/custom-providers/${createdId}`)
        .set(headers)
        .send({ base_url: 'localhost:9000' })
        .expect(400);
    });

    async function withSsrfValidation(run: () => Promise<void>): Promise<void> {
      const originalSkip = process.env['SKIP_SSRF_VALIDATION'];
      process.env['SKIP_SSRF_VALIDATION'] = 'false';
      try {
        await run();
      } finally {
        if (originalSkip === undefined) delete process.env['SKIP_SSRF_VALIDATION'];
        else process.env['SKIP_SSRF_VALIDATION'] = originalSkip;
      }
    }

    it('rejects plaintext http to a public host on update', async () => {
      await withSsrfValidation(async () => {
        await request(app.getHttpServer())
          .put(`/api/v1/routing/${agentName}/custom-providers/${createdId}`)
          .set(headers)
          .send({ base_url: 'http://93.184.216.34/v1' })
          .expect(400);
      });
    });

    it('accepts a LAN URL on update and still rejects cloud metadata', async () => {
      await withSsrfValidation(async () => {
        const res = await request(app.getHttpServer())
          .put(`/api/v1/routing/${agentName}/custom-providers/${createdId}`)
          .set(headers)
          .send({ base_url: 'http://192.168.1.50:11434/v1' })
          .expect(200);
        expect(res.body.base_url).toBe('http://192.168.1.50:11434/v1');

        await request(app.getHttpServer())
          .put(`/api/v1/routing/${agentName}/custom-providers/${createdId}`)
          .set(headers)
          .send({ base_url: 'http://169.254.169.254/latest/meta-data' })
          .expect(400);
      });
    });

    it('accepts a fresh valid https URL on update (sanity)', async () => {
      // Negative-space control: a well-formed public URL must succeed
      // and the new base_url must persist.
      const res = await request(app.getHttpServer())
        .put(`/api/v1/routing/${agentName}/custom-providers/${createdId}`)
        .set(headers)
        .send({ base_url: 'https://api.example.com/openai/v1' })
        .expect(200);

      expect(res.body.base_url).toBe('https://api.example.com/openai/v1');
    });
  });
});
