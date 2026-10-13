import assert from 'node:assert/strict';
import { test } from 'node:test';

const baseUrl = process.env.THINKER_BASE_URL;

if (!baseUrl) {
  throw new Error('THINKER_BASE_URL is required');
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let responseBody;

  try {
    responseBody = JSON.parse(text);
  } catch {
    assert.fail(`${path} returned non-JSON response: ${text}`);
  }

  return { status: response.status, body: responseBody, text };
}

function assertAuthenticationRequired(path, result) {
  assert.equal(
    result.status,
    401,
    `${path} returned HTTP ${result.status} instead of 401: ${result.text}`,
  );
  assert.equal(
    result.body?.error?.type,
    'auth_error',
    `${path} did not return the gateway authentication error: ${result.text}`,
  );
  assert.equal(
    typeof result.body?.error?.message,
    'string',
    `${path} did not return an authentication error message: ${result.text}`,
  );
  assert.ok(
    result.body.error.message.trim().length > 0,
    `${path} returned an empty authentication error message: ${result.text}`,
  );
}

test('GET /v1/models remains available', async () => {
  const result = await request('/v1/models');

  assertAuthenticationRequired('/v1/models', result);
});

test('POST /v1/chat/completions remains available', async () => {
  const result = await request('/v1/chat/completions', {
    method: 'POST',
    body: {
      model: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  assertAuthenticationRequired('/v1/chat/completions', result);
});

test('POST /v1/responses remains available', async () => {
  const result = await request('/v1/responses', {
    method: 'POST',
    body: {
      model: 'auto',
      input: 'hello',
    },
  });

  assertAuthenticationRequired('/v1/responses', result);
});

test('POST /v1/messages remains available', async () => {
  const result = await request('/v1/messages', {
    method: 'POST',
    body: {
      model: 'auto',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  assertAuthenticationRequired('/v1/messages', result);
});

// Keys that are well-formed but belong to no agent. They exercise header
// handling only; no contract run ever holds a real key.
const UNKNOWN_KEY_A = 'thk_contract-unknown-key-a';
const UNKNOWN_KEY_B = 'thk_contract-unknown-key-b';

const MESSAGES_BODY = {
  model: 'auto',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hello' }],
};

test('POST /v1/messages reads the agent key from x-api-key', async () => {
  const result = await request('/v1/messages', {
    method: 'POST',
    body: MESSAGES_BODY,
    headers: { 'x-api-key': UNKNOWN_KEY_A },
  });

  assertAuthenticationRequired('/v1/messages', result);
  // The key was read and looked up (M005 "key not recognized"), not reported
  // as missing (M001) or malformed (M003).
  assert.match(
    result.body.error.message,
    /\bM005\b/,
    `/v1/messages did not check the x-api-key header: ${result.text}`,
  );
});

test('POST /v1/messages rejects different keys in Authorization and x-api-key', async () => {
  const result = await request('/v1/messages', {
    method: 'POST',
    body: MESSAGES_BODY,
    headers: { Authorization: `Bearer ${UNKNOWN_KEY_A}`, 'x-api-key': UNKNOWN_KEY_B },
  });

  assertAuthenticationRequired('/v1/messages', result);
  assert.match(
    result.body.error.message,
    /\bM006\b/,
    `/v1/messages did not report conflicting keys: ${result.text}`,
  );
});
