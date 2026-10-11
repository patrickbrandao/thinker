/**
 * #18 review S1: DNS rebinding against custom-provider URLs.
 *
 * Custom providers may point at LAN and loopback hosts (local models), so the
 * URL check runs with allowPrivate. A hostile resolver can answer a public
 * address while the URL is validated and a cloud metadata address when the
 * request connects. The request must be pinned to the address it validated:
 * the probe and the forward go through `ssrfSafeFetch`, whose lookup refuses
 * metadata at connect time.
 *
 * Harness, all in-process and offline:
 * - both DNS modules are mocked: the attacker's hostname answers "public" a set
 *   number of times, then 169.254.169.254;
 * - `net.Socket.prototype.connect` is wrapped so any connection the process
 *   would make to 169.254.169.254 lands on a local TCP listener instead. The
 *   listener stands in for the metadata service and counts connections, so a
 *   regression shows up as a counted connection rather than a hang.
 */
import * as net from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TEST_API_KEY, TEST_OTLP_KEY } from './helpers';

const REBIND_HOST = 'rebind.thinker-e2e.example';

interface MockRebindState {
  /** Answers left before the attacker's name starts resolving to metadata. */
  benignAnswersLeft: number;
  /** What a benign answer is: a public address, or loopback (control case). */
  benign: '93.184.216.34' | '127.0.0.1';
  /** Answers handed out for the attacker's name, in order. */
  answers: string[];
}

// Shared with the jest.mock factories below (they may only touch `mock*` names
// or globals), so it lives on globalThis.
const mockRebind: MockRebindState = {
  benignAnswersLeft: 0,
  benign: '93.184.216.34',
  answers: [],
};
(globalThis as { mockRebind?: MockRebindState }).mockRebind = mockRebind;

jest.mock('dns/promises', () => {
  const actual = jest.requireActual('dns/promises');
  return {
    ...actual,
    lookup: jest.fn((hostname: string, options?: { all?: boolean }) => {
      const state = (globalThis as { mockRebind?: MockRebindState }).mockRebind!;
      if (hostname !== 'rebind.thinker-e2e.example') return actual.lookup(hostname, options);
      const address = state.benignAnswersLeft-- > 0 ? state.benign : '169.254.169.254';
      state.answers.push(address);
      const entry = { address, family: 4 };
      return Promise.resolve(options?.all ? [entry] : entry);
    }),
  };
});
// Jest resolves `node:dns/promises` to the same module, so this one mock also
// covers the import in ssrf-safe-fetch.ts.

describe('Custom provider DNS rebinding to cloud metadata (e2e)', () => {
  let app: INestApplication;
  let metadataStandIn: net.Server;
  let metadataPort: number;
  let metadataConnections = 0;
  let previousSkip: string | undefined;
  const originalConnect = net.Socket.prototype.connect;
  const api = () => request(app.getHttpServer());
  const dashboard = (test: request.Test) => test.set('x-api-key', TEST_API_KEY);
  const agent = (test: request.Test) => test.set('Authorization', `Bearer ${TEST_OTLP_KEY}`);

  beforeAll(async () => {
    metadataStandIn = net.createServer((socket) => {
      metadataConnections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => metadataStandIn.listen(0, '127.0.0.1', resolve));
    metadataPort = (metadataStandIn.address() as net.AddressInfo).port;

    // Divert every connection the process would open to 169.254.169.254 onto
    // the stand-in, whichever resolver produced the address.
    const divert = (address: string) => (address === '169.254.169.254' ? '127.0.0.1' : address);
    net.Socket.prototype.connect = function patchedConnect(
      this: net.Socket,
      ...args: unknown[]
    ): net.Socket {
      const first = args[0];
      const options = (Array.isArray(first) ? first[0] : first) as
        (net.TcpNetConnectOpts & { lookup?: net.LookupFunction }) | undefined;
      if (options && typeof options === 'object' && typeof options.host === 'string') {
        const inner = options.lookup;
        options.lookup = ((hostname: string, lookupOptions: unknown, callback: unknown) => {
          const done = callback as (
            err: Error | null,
            address: string | { address: string; family: number }[],
            family?: number,
          ) => void;
          if (!inner) {
            // Plain fetch path: resolve the attacker's name like a real resolver would.
            const state = mockRebind;
            const address =
              hostname === REBIND_HOST
                ? state.benignAnswersLeft-- > 0
                  ? state.benign
                  : '169.254.169.254'
                : hostname;
            if (hostname === REBIND_HOST) state.answers.push(address);
            const all = (lookupOptions as { all?: boolean } | undefined)?.all;
            const mapped = divert(address === 'localhost' ? '127.0.0.1' : address);
            if (all) done(null, [{ address: mapped, family: 4 }]);
            else done(null, mapped, 4);
            return;
          }
          inner(
            hostname,
            lookupOptions as never,
            ((
              err: Error | null,
              address: string | { address: string; family: number }[],
              family?: number,
            ) => {
              if (err) return done(err, '', 0);
              if (Array.isArray(address)) {
                return done(
                  null,
                  address.map((entry) => ({ ...entry, address: divert(entry.address) })),
                );
              }
              return done(null, divert(address), family);
            }) as never,
          );
        }) as net.LookupFunction;
      }
      return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    } as typeof net.Socket.prototype.connect;

    previousSkip = process.env['SKIP_SSRF_VALIDATION'];
    process.env['SKIP_SSRF_VALIDATION'] = 'false';
    app = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    net.Socket.prototype.connect = originalConnect;
    if (previousSkip === undefined) delete process.env['SKIP_SSRF_VALIDATION'];
    else process.env['SKIP_SSRF_VALIDATION'] = previousSkip;
    await app?.close();
    await new Promise<void>((resolve) => metadataStandIn.close(() => resolve()));
  });

  beforeEach(() => {
    metadataConnections = 0;
    mockRebind.answers = [];
  });

  const rebindUrl = () => `https://${REBIND_HOST}:${metadataPort}/v1`;

  it('control: the harness counts a connection when the name resolves to an allowed address', async () => {
    mockRebind.benign = '127.0.0.1';
    mockRebind.benignAnswersLeft = 100;

    await dashboard(api().post('/api/v1/routing/test-agent/custom-providers/probe')).send({
      base_url: rebindUrl(),
    });

    expect(metadataConnections).toBeGreaterThan(0);
  });

  it('probe: passes validation on a public answer, then refuses the metadata answer at connect', async () => {
    mockRebind.benign = '93.184.216.34';
    mockRebind.benignAnswersLeft = 1; // validation only

    const res = await dashboard(
      api().post('/api/v1/routing/test-agent/custom-providers/probe'),
    ).send({ base_url: rebindUrl() });

    expect(mockRebind.answers[0]).toBe('93.184.216.34');
    expect(mockRebind.answers).toContain('169.254.169.254');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(metadataConnections).toBe(0);
  });

  it('forward: create and revalidation see a public answer, the connection is refused', async () => {
    mockRebind.benign = '93.184.216.34';
    mockRebind.benignAnswersLeft = 2; // create-time validation + forward-time revalidation

    const created = await dashboard(api().post('/api/v1/routing/test-agent/custom-providers'))
      .send({
        name: 'Rebinding Provider',
        base_url: rebindUrl(),
        apiKey: 'rebind-key',
        models: [
          {
            model_name: 'rebind-model',
            input_price_per_million_tokens: 0,
            output_price_per_million_tokens: 0,
          },
        ],
      })
      .expect(201);
    const model = `custom:${created.body.id as string}/rebind-model`;
    for (const tier of ['simple', 'standard', 'complex', 'reasoning', 'default']) {
      await dashboard(api().put(`/api/v1/routing/test-agent/tiers/${tier}`))
        .send({ model })
        .expect(200);
    }

    const res = await agent(api().post('/v1/chat/completions')).send({
      model,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });

    expect(mockRebind.answers.slice(0, 2)).toEqual(['93.184.216.34', '93.184.216.34']);
    expect(mockRebind.answers).toContain('169.254.169.254');
    expect(JSON.stringify(res.body)).not.toContain('recorded');
    expect(metadataConnections).toBe(0);
  });

  it('refuses a custom provider whose hostname does not resolve (.invalid)', async () => {
    const res = await dashboard(api().post('/api/v1/routing/test-agent/custom-providers'))
      .send({
        name: 'Unresolvable',
        base_url: 'http://nonexistent-xyz-thinker.invalid/v1',
        models: [{ model_name: 'm1' }],
      })
      .expect(400);

    expect((res.body as { message?: string }).message).toContain('Failed to resolve hostname');
  });
});
