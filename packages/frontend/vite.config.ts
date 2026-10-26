import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type ProxyOptions } from 'vite';
import solidPlugin from 'vite-plugin-solid';

// Dial the backend on 127.0.0.1, not `localhost`. The dev backend binds
// 127.0.0.1 (IPv4), but on dual-stack machines `localhost` can resolve to
// ::1 (IPv6) first, so proxied requests intermittently hit a port nothing is
// listening on.
const backendTarget = `http://127.0.0.1:${process.env.VITE_BACKEND_PORT || '3001'}`;

// `nest --watch` restarts the backend on every save, and http-proxy reuses
// keep-alive sockets that die across a restart. Without this handler Vite
// answers the blip with a bare 502 carrying no CORS headers, which a
// cross-origin caller reports as a misleading CORS failure. Echo the request
// Origin back on the error response so the failure reads as an honest 502.
const configureDevProxy: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('error', (err, req, res) => {
    // Websocket upgrades hand back a raw socket with no `writeHead`; only
    // real HTTP responses can carry a status line + headers.
    if (!('writeHead' in res) || res.headersSent) return;
    const origin = req.headers.origin;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(502, headers);
    res.end(JSON.stringify({ error: 'dev proxy: backend unreachable', detail: err.message }));
  });
};

const devProxyRoute: ProxyOptions = { target: backendTarget, configure: configureDevProxy };

const thinkerVersion = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../thinker/package.json'), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? '';
  } catch {
    return '';
  }
})();

export default defineConfig({
  define: {
    // The version shown by the dashboard badge. Read from the canonical
    // package.json at build time so the dashboard never asks the backend (or
    // anyone else) for it.
    __THINKER_VERSION__: JSON.stringify(thinkerVersion),
  },
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    // Disable Vite's built-in CORS handler. Otherwise it short-circuits
    // OPTIONS preflights for proxied paths (e.g. `/api`, `/v1`) and strips
    // the backend's own CORS headers. The dashboard itself is same-origin,
    // so it doesn't need Vite's CORS at all.
    cors: false,
    proxy: {
      '/api': devProxyRoute,
      '/otlp': devProxyRoute,
      '/v1': devProxyRoute,
    },
  },
  build: {
    target: 'esnext',
    rolldownOptions: {
      output: {
        // Named chunks for the heavy third-party libraries. Their names stay
        // stable across releases so browsers keep them cached while the route
        // chunks churn. Each group also pulls in the module's own transitive
        // dependencies (Rolldown's `includeDependenciesRecursively` default).
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules[\\/](solid-js|@solidjs)[\\/]/ },
            { name: 'charts', test: /node_modules[\\/]uplot[\\/]/ },
            { name: 'auth', test: /node_modules[\\/]better-auth[\\/]/ },
            // Syntax highlighting (highlight.js) is only pulled in by the
            // recorded-message viewer. Pin it to a stable named chunk so it
            // caches independently of the route chunks that lazy-load it.
            { name: 'syntax', test: /node_modules[\\/]highlight\.js[\\/]/ },
            // Markdown rendering (marked + dompurify) is shared across the
            // few surfaces that render model output. A dedicated chunk keeps
            // its hash stable across route-chunk changes.
            { name: 'markdown', test: /node_modules[\\/](marked|dompurify)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    transformMode: { web: [/\.[jt]sx?$/] },
    deps: {
      optimizer: { web: { include: ['solid-js'] } },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/index.tsx',
        'src/components/CostChart.tsx',
        'src/components/TokenChart.tsx',
        'src/components/SingleTokenChart.tsx',
        'src/components/Sparkline.tsx',
      ],
    },
  },
});
