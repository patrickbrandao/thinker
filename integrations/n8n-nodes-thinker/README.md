# n8n-nodes-thinker

Use [Thinker](https://github.com/patrickbrandao/thinker) from n8n workflows. Thinker routes requests through the right AI model behind one OpenAI-compatible API.

This package ships two nodes:

## Thinker Chat Model (recommended)

A language-model sub-node built on [`@n8n/ai-node-sdk`](https://github.com/n8n-io/n8n/tree/master/packages/%40n8n/ai-node-sdk). Connect it to the **AI Agent** or **Basic LLM Chain** node exactly like the OpenAI Chat Model node — Thinker sits between your agent and the providers and routes each request to the cheapest capable model.

- Model list is loaded from your Thinker instance; the default `auto` lets Thinker route every request.
- Supports streaming, tool calling, and (optionally) the OpenAI Responses API.
- Requires an n8n version that ships `@n8n/ai-node-sdk` (2026 releases).

## Thinker (action node)

A regular node for calling Thinker directly from a workflow, without an AI Agent:

- List models from `GET /v1/models`
- Create chat completions with `POST /v1/chat/completions`
- Create Responses API calls with `POST /v1/responses`

### Response output

The action node handles both response formats returned by Thinker:

- Buffered responses are returned as the API's JSON object.
- Streamed responses are returned as parsed server-sent events after the stream completes:

```json
{
	"responseMode": "stream",
	"events": [
		{
			"event": "message",
			"data": { "choices": [{ "delta": { "content": "Hello" } }] }
		},
		{ "event": "message", "data": "[DONE]" }
	]
}
```

The action node waits for a streamed response to finish before passing its parsed events to the next workflow node. Do not set `stream` in **Additional Body**; the node ignores that field so response behavior remains consistent with the route configured in Thinker.

## Credentials

Create a **Thinker API** credential with:

- **Base URL**: the URL of your Thinker instance. The default, `http://localhost:2099`, only works when n8n runs on the same host as Thinker; from an n8n container, use the address of the Thinker service (for example `http://thinker:2099` on a shared Docker network).
- **API Key**: a Thinker agent API key. It starts with `thk_`; the nodes refuse any other key before sending a request.

The credential sends requests with:

```text
Authorization: Bearer <your Thinker API key>
User-Agent: n8n-nodes-thinker
X-Title: n8n
HTTP-Referer: https://n8n.io
```

Thinker uses those headers to attribute usage to this node on request details.

## Install

The package is not published to any registry. Build it and install the tarball as a community node:

```bash
cd integrations/n8n-nodes-thinker
npm ci
npm run build
npm pack                      # writes n8n-nodes-thinker-<version>.tgz
```

Then, on the n8n host (or inside the n8n container), install the tarball into n8n's custom nodes directory and restart n8n:

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /path/to/n8n-nodes-thinker-<version>.tgz
```

The **Thinker** and **Thinker Chat Model** nodes then appear in the node panel.

## Development

```bash
npm ci
npm run dev     # n8n with this package linked
npm test        # build, then the node:test suite
npm run lint
```
