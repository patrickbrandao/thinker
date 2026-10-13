import assert from 'node:assert/strict';
import { test } from 'node:test';

// Client-visible Thinker identifiers (#21): agent keys start with `thk_` and
// routed responses carry `x-thinker-*` headers. Nothing from the upstream
// project's key prefix or header namespace is accepted or sent.

const baseUrl = process.env.THINKER_BASE_URL;

if (!baseUrl) {
  throw new Error('THINKER_BASE_URL is required');
}

// Optional: the key of an agent whose default route reaches a working
// provider. The routed-response contract needs it and is skipped without it.
// Docker Smoke passes the throwaway agent it creates.
const agentKey = process.env.THINKER_CONTRACT_AGENT_KEY;

const MESSAGES_BODY = {
  model: 'auto',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hello' }],
};

async function post(path, { body, headers = {} }) {
  const response = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    assert.fail(`${path} returned non-JSON response: ${text}`);
  }
  return { status: response.status, headers: response.headers, body: json, text };
}

test('a well-formed thk_ key is looked up, not rejected as malformed', async () => {
  const result = await post('/v1/messages', {
    body: MESSAGES_BODY,
    headers: { Authorization: 'Bearer thk_contract-identifiers-unknown-key' },
  });

  assert.equal(result.status, 401, result.text);
  assert.equal(result.body?.error?.type, 'auth_error', result.text);
  // M005 "key not recognized": the prefix was accepted and the key looked up.
  assert.match(result.body.error.message, /\bM005\b/, result.text);
});

test('a key without the thk_ prefix is malformed and the error names thk_', async () => {
  // The upstream project's prefix is not an alias.
  const legacyKey = ['mnfst', 'contract-identifiers-legacy-key'].join('_');
  const result = await post('/v1/messages', {
    body: MESSAGES_BODY,
    headers: { Authorization: `Bearer ${legacyKey}` },
  });

  assert.equal(result.status, 401, result.text);
  assert.equal(result.body?.error?.type, 'auth_error', result.text);
  assert.match(result.body.error.message, /\bM003\b/, result.text);
  assert.ok(
    result.body.error.message.includes('thk_'),
    `the malformed-key error does not name the thk_ prefix: ${result.text}`,
  );
});

test(
  'a routed response carries x-thinker-* headers and no legacy upstream header',
  { skip: agentKey ? false : 'set THINKER_CONTRACT_AGENT_KEY to a routable agent key' },
  async () => {
    const result = await post('/v1/chat/completions', {
      body: { model: 'auto', messages: [{ role: 'user', content: 'hello' }], stream: false },
      headers: { Authorization: `Bearer ${agentKey}` },
    });

    assert.equal(result.status, 200, result.text);
    for (const name of ['x-thinker-tier', 'x-thinker-model', 'x-thinker-provider']) {
      assert.ok(result.headers.get(name), `missing ${name}: ${result.text}`);
    }
    const legacyPrefix = ['x', 'manifest', ''].join('-');
    const legacy = [...result.headers.keys()].filter((name) => name.startsWith(legacyPrefix));
    assert.deepEqual(legacy, [], `legacy headers present: ${legacy.join(', ')}`);
  },
);
