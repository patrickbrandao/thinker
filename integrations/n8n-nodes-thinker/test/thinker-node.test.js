const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
	Thinker,
	parseThinkerResponse,
	parseServerSentEvents,
	withoutRouteManagedStream,
} = require('../dist/nodes/Thinker/Thinker.node.js');

const ATTRIBUTION_HEADERS = {
	Authorization: 'Bearer thk_test_key',
	'User-Agent': 'n8n-nodes-thinker',
	'X-Title': 'n8n',
	'HTTP-Referer': 'https://n8n.io',
};

test('keeps node metadata valid in package files', () => {
	const packageName = require('../package.json').name;
	const thinkerDescription = new Thinker().description;
	const allowedFields = new Set([
		'alias',
		'categories',
		'codexVersion',
		'node',
		'nodeVersion',
		'resources',
	]);
	const codexFiles = [
		['../nodes/Thinker/Thinker.node.json', `${packageName}.${thinkerDescription.name}`],
		['../dist/nodes/Thinker/Thinker.node.json', `${packageName}.${thinkerDescription.name}`],
		['../nodes/LmChatThinker/LmChatThinker.node.json', `${packageName}.lmChatThinker`],
		['../dist/nodes/LmChatThinker/LmChatThinker.node.json', `${packageName}.lmChatThinker`],
	];

	assert.equal(thinkerDescription.usableAsTool, true);

	for (const [relativePath, expectedNode] of codexFiles) {
		const codex = JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'));

		assert.equal(codex.node, expectedNode);
		assert.deepEqual(codex.categories, ['Development']);
		assert.ok(Object.keys(codex).every((field) => allowedFields.has(field)));
	}
});

function executionContext(parameters, response, requests) {
	return {
		continueOnFail: () => false,
		getCredentials: async () => ({
			apiKey: 'thk_test_key',
			baseUrl: 'http://thinker.test/',
		}),
		getInputData: () => [{ json: {} }],
		getNode: () => ({
			name: 'Thinker',
			type: 'n8n-nodes-thinker.thinker',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getNodeParameter: (name, _itemIndex, fallback) => parameters[name] ?? fallback,
		helpers: {
			httpRequest: async (request) => {
				requests.push(request);
				return response;
			},
		},
	};
}

test('removes a client stream override without mutating additional fields', () => {
	const additionalBody = { stream: true, temperature: 0.2 };

	assert.deepEqual(withoutRouteManagedStream(additionalBody), { temperature: 0.2 });
	assert.deepEqual(additionalBody, { stream: true, temperature: 0.2 });
});

test('returns buffered JSON responses as objects', () => {
	const response = parseThinkerResponse({
		body: '{"id":"chatcmpl_123","choices":[]}',
		headers: { 'content-type': 'application/json' },
		statusCode: 200,
	});

	assert.deepEqual(response, { id: 'chatcmpl_123', choices: [] });
});

test('parses chat completion event streams including the terminal marker', () => {
	const response = parseThinkerResponse({
		body:
			': keepalive\r\n\r\n' +
			'id: evt_1\r\ndata: {"choices":[{"delta":{"content":"Hello"}}]}\r\n\r\n' +
			'data: [DONE]\r\n\r\n',
		headers: { 'Content-Type': 'Text/Event-Stream; Charset=UTF-8' },
		statusCode: 200,
	});

	assert.deepEqual(response, {
		responseMode: 'stream',
		events: [
			{
				event: 'message',
				id: 'evt_1',
				data: { choices: [{ delta: { content: 'Hello' } }] },
			},
			{ event: 'message', data: '[DONE]' },
		],
	});
});

test('preserves named Responses API events and multiline data', () => {
	assert.deepEqual(
		parseServerSentEvents(
			'event: response.output_text.delta\ndata: first line\ndata: second line\n\n',
		),
		{
			responseMode: 'stream',
			events: [
				{
					event: 'response.output_text.delta',
					data: 'first line\nsecond line',
				},
			],
		},
	);
});

test('preserves a non-JSON buffered response as text', () => {
	const response = parseThinkerResponse({
		body: 'plain text',
		headers: { 'content-type': 'text/plain' },
		statusCode: 200,
	});

	assert.equal(response, 'plain text');
});

test('attaches Thinker attribution headers when listing models', async () => {
	const requests = [];
	const context = executionContext(
		{ operation: 'listModels' },
		{
			body: '{"data":[]}',
			headers: { 'content-type': 'application/json' },
			statusCode: 200,
		},
		requests,
	);

	await new Thinker().execute.call(context);

	assert.deepEqual(requests[0].headers, ATTRIBUTION_HEADERS);
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[0].url, 'http://thinker.test/v1/models');
});

test('executes chat completions without overriding the route response mode', async () => {
	const requests = [];
	const context = executionContext(
		{
			operation: 'chatCompletion',
			model: 'auto',
			messages: '[{"role":"user","content":"Hello"}]',
			additionalBody: '{"stream":true,"temperature":0.2}',
		},
		{
			body: '{"choices":[]}',
			headers: { 'content-type': 'application/json' },
			statusCode: 200,
		},
		requests,
	);

	const result = await new Thinker().execute.call(context);

	assert.deepEqual(result, [[{ json: { choices: [] }, pairedItem: { item: 0 } }]]);
	assert.deepEqual(requests, [
		{
			method: 'POST',
			url: 'http://thinker.test/v1/chat/completions',
			headers: ATTRIBUTION_HEADERS,
			encoding: 'text',
			returnFullResponse: true,
			json: true,
			body: {
				temperature: 0.2,
				model: 'auto',
				messages: [{ role: 'user', content: 'Hello' }],
			},
		},
	]);
});

test('executes Responses API calls with parsed streaming output', async () => {
	const requests = [];
	const context = executionContext(
		{
			operation: 'createResponse',
			model: 'auto',
			input: 'Hello',
			additionalBody: '{"stream":false,"max_output_tokens":20}',
		},
		{
			body:
				'event: response.output_text.delta\ndata: {"delta":"Hello"}\n\n' +
				'event: response.completed\ndata: {"response":{"status":"completed"}}\n\n',
			headers: { 'content-type': 'text/event-stream' },
			statusCode: 200,
		},
		requests,
	);

	const result = await new Thinker().execute.call(context);

	assert.deepEqual(requests[0].headers, ATTRIBUTION_HEADERS);
	assert.deepEqual(requests[0].body, {
		max_output_tokens: 20,
		model: 'auto',
		input: 'Hello',
	});
	assert.deepEqual(result, [
		[
			{
				json: {
					responseMode: 'stream',
					events: [
						{
							event: 'response.output_text.delta',
							data: { delta: 'Hello' },
						},
						{
							event: 'response.completed',
							data: { response: { status: 'completed' } },
						},
					],
				},
				pairedItem: { item: 0 },
			},
		],
	]);
});

test('sends requests to a local Thinker instance when no base URL was saved', async () => {
	const requests = [];
	const context = executionContext(
		{ operation: 'listModels' },
		{ body: '{"data":[]}', headers: { 'content-type': 'application/json' }, statusCode: 200 },
		requests,
	);
	context.getCredentials = async () => ({ apiKey: 'thk_test_key' });

	await new Thinker().execute.call(context);

	assert.equal(requests[0].url, 'http://localhost:2099/v1/models');
});

test('refuses an API key without the thk_ prefix before sending any request', async () => {
	for (const apiKey of ['sk-openai-key', '', undefined]) {
		const requests = [];
		const context = executionContext(
			{ operation: 'listModels' },
			{ body: '{"data":[]}', headers: { 'content-type': 'application/json' }, statusCode: 200 },
			requests,
		);
		context.getCredentials = async () => ({ apiKey, baseUrl: 'http://thinker.test' });

		await assert.rejects(() => new Thinker().execute.call(context), /starting with thk_/);
		assert.deepEqual(requests, []);
	}
});

test('names the credential, nodes and package after Thinker', () => {
	const { ThinkerApi } = require('../dist/credentials/ThinkerApi.credentials.js');
	const { LmChatThinker } = require('../dist/nodes/LmChatThinker/LmChatThinker.node.js');
	const pkg = require('../package.json');
	const credential = new ThinkerApi();

	assert.equal(credential.name, 'thinkerApi');
	assert.equal(
		credential.properties.find((p) => p.name === 'baseUrl').default,
		'http://localhost:2099',
	);
	assert.equal(new Thinker().description.name, 'thinker');
	assert.equal(new LmChatThinker().description.name, 'lmChatThinker');
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/ThinkerApi.credentials.js']);
	assert.deepEqual(pkg.n8n.nodes, [
		'dist/nodes/Thinker/Thinker.node.js',
		'dist/nodes/LmChatThinker/LmChatThinker.node.js',
	]);
});
