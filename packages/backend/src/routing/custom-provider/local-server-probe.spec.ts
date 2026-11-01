import { LocalProbeError, ollamaModelName, probeLocalServer } from './local-server-probe';
import type { LocalServerConfig } from '../../common/constants/local-servers';

const config = (port: number): LocalServerConfig => ({
  scheme: 'http',
  host: '192.168.1.20',
  port,
  path_prefix: '',
  request_timeout_ms: 600_000,
  probe_timeout_ms: 2_000,
});

type Routes = Record<
  string,
  { status?: number; body?: unknown } | ((init: RequestInit) => unknown)
>;

function fakeFetch(routes: Routes) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname.replace(/^\/llama/, '');
    const route = routes[`${init.method ?? 'GET'} ${path}`];
    if (!route) return new Response('not found', { status: 404 });
    const r = typeof route === 'function' ? { body: route(init) } : route;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn, calls };
}

describe('probeLocalServer', () => {
  it('strips the implicit :latest tag of Ollama names', () => {
    expect(ollamaModelName('llama3.2:latest')).toBe('llama3.2');
    expect(ollamaModelName('qwen3:8b')).toBe('qwen3:8b');
  });

  it('reads Ollama version, tags, ps and show, dropping embedding models', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/version': { body: { version: '0.12.3' } },
      'GET /api/tags': {
        body: {
          models: [
            { name: 'llama3.2:latest' },
            { name: 'nomic-embed-text:latest' },
            { name: 'qwen3:8b' },
          ],
        },
      },
      'GET /api/ps': { body: { models: [{ name: 'qwen3:8b' }] } },
      'POST /api/show': (init) => {
        const model = JSON.parse(String(init.body)).model as string;
        if (model.startsWith('nomic')) return { capabilities: ['embedding'] };
        if (model.startsWith('qwen3'))
          return {
            capabilities: ['completion', 'tools', 'thinking'],
            model_info: { 'qwen3.context_length': 40960 },
          };
        return {
          capabilities: ['completion', 'vision'],
          model_info: { 'llama.context_length': 131072 },
        };
      },
    });
    const result = await probeLocalServer('ollama', config(11434), undefined, fn);
    expect(result).toEqual({
      version: '0.12.3',
      models: [
        { model_name: 'llama3.2', context_window: 131072, capabilities: ['vision'], loaded: false },
        {
          model_name: 'qwen3:8b',
          context_window: 40960,
          capabilities: ['tools', 'reasoning'],
          loaded: true,
        },
      ],
    });
    expect(calls[0].url).toBe('http://192.168.1.20:11434/api/version');
    expect(calls.every((c) => c.init.redirect === 'error')).toBe(true);
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('sends the API key as a bearer token', async () => {
    const { fn, calls } = fakeFetch({ 'GET /api/tags': { body: { models: [] } } });
    await probeLocalServer('ollama', config(11434), 'tok-123', fn);
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer tok-123' });
  });

  it('reads LM Studio /api/v1/models, keeping LLMs only', async () => {
    const { fn } = fakeFetch({
      'GET /api/v1/models': {
        body: {
          models: [
            {
              type: 'llm',
              key: 'google/gemma-4-26b-a4b',
              max_context_length: 262144,
              loaded_instances: [{ id: 'x', config: { context_length: 4096 } }],
              capabilities: {
                vision: true,
                trained_for_tool_use: true,
                reasoning: { default: 'on' },
              },
            },
            { type: 'llm', key: 'deepseek-r1', max_context_length: 131072, loaded_instances: [] },
            { type: 'embedding', key: 'nomic', loaded_instances: [] },
            { type: 'llm', key: 'stable-diffusion-3.5-large', architecture: 'sd3' },
            { type: 'llm', key: 'laya-multilingual', architecture: 'modern-bert' },
          ],
        },
      },
    });
    const { models } = await probeLocalServer('lmstudio', config(1234), undefined, fn);
    expect(models).toEqual([
      {
        model_name: 'google/gemma-4-26b-a4b',
        context_window: 4096,
        capabilities: ['tools', 'vision', 'reasoning'],
        loaded: true,
      },
      { model_name: 'deepseek-r1', context_window: 131072, capabilities: undefined, loaded: false },
    ]);
  });

  it('falls back to LM Studio /api/v0/models, then to /v1/models', async () => {
    const v0 = fakeFetch({
      'GET /api/v0/models': {
        body: {
          data: [
            { id: 'qwen2-vl', type: 'vlm', state: 'loaded', max_context_length: 32768 },
            { id: 'nomic', type: 'embeddings', state: 'not-loaded' },
          ],
        },
      },
    });
    expect((await probeLocalServer('lmstudio', config(1234), undefined, v0.fn)).models).toEqual([
      { model_name: 'qwen2-vl', context_window: 32768, capabilities: ['vision'], loaded: true },
    ]);
    const plain = fakeFetch({ 'GET /v1/models': { body: { data: [{ id: 'm1' }] } } });
    expect((await probeLocalServer('lmstudio', config(1234), undefined, plain.fn)).models).toEqual([
      { model_name: 'm1' },
    ]);
  });

  it('reads llama-server /health, /v1/models and /props for a single model', async () => {
    const { fn, calls } = fakeFetch({
      'GET /health': { body: { status: 'ok' } },
      'GET /v1/models': { body: { data: [{ id: 'gemma-3-4b', meta: { n_ctx_train: 131072 } }] } },
      'GET /props': {
        body: {
          build_info: 'b7000-abc',
          default_generation_settings: { n_ctx: 8192 },
          modalities: { vision: true },
        },
      },
    });
    const prefixed = { ...config(9931), path_prefix: '/llama' };
    expect(await probeLocalServer('llamacpp', prefixed, undefined, fn)).toEqual({
      version: 'b7000-abc',
      models: [
        { model_name: 'gemma-3-4b', context_window: 8192, capabilities: ['vision'], loaded: true },
      ],
    });
    expect(calls.map((c) => c.url)).toEqual([
      'http://192.168.1.20:9931/llama/health',
      'http://192.168.1.20:9931/llama/v1/models',
      'http://192.168.1.20:9931/llama/props',
    ]);
  });

  it('reports router-mode load state per model', async () => {
    const { fn } = fakeFetch({
      'GET /v1/models': {
        body: {
          data: [
            { id: 'a', status: { value: 'loaded' } },
            {
              id: 'b',
              status: { value: 'unloaded' },
              architecture: { input_modalities: ['text', 'image'] },
            },
          ],
        },
      },
    });
    const { models } = await probeLocalServer('llamacpp', config(9931), undefined, fn);
    expect(models).toEqual([
      { model_name: 'a', context_window: undefined, capabilities: undefined, loaded: true },
      { model_name: 'b', context_window: undefined, capabilities: ['vision'], loaded: false },
    ]);
  });

  it('turns an auth failure into a readable error without the key', async () => {
    const { fn } = fakeFetch({ 'GET /v1/models': { status: 401, body: {} } });
    const err = await probeLocalServer('llamacpp', config(9931), 'secret-key', fn).catch((e) => e);
    expect(err).toBeInstanceOf(LocalProbeError);
    expect(err.message).toContain('HTTP 401');
    expect(err.message).not.toContain('secret-key');
  });

  it('reports a refused connection', async () => {
    const fn = jest.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    await expect(probeLocalServer('ollama', config(11434), undefined, fn)).rejects.toThrow(
      'No server is listening on http://192.168.1.20:11434/api/tags.\nStart it with `ollama serve`',
    );
    await expect(probeLocalServer('lmstudio', config(1235), undefined, fn)).rejects.toThrow(
      'Start it with `lms server start --port 1235`',
    );
  });
});
