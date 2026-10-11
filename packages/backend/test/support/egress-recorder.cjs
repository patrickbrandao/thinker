/**
 * Preloaded (`node -r`) into the server process that
 * `no-phonehome-egress.e2e-spec.ts` boots. Records every `fetch` URL and every
 * DNS lookup to the JSON-lines file named by `EGRESS_LOG`, and keeps the
 * process off the network: a remote `fetch` gets a 503 and a remote hostname
 * fails to resolve. The DNS hook also sees `http`/`https`/`net` connections
 * that bypass `fetch`.
 */
'use strict';

const fs = require('fs');
const dns = require('dns');

const logFile = process.env.EGRESS_LOG;
if (!logFile) throw new Error('EGRESS_LOG is required');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function record(kind, target) {
  fs.appendFileSync(logFile, JSON.stringify({ kind, target }) + '\n');
}

// Proves the recorder is loaded even when a run makes no outbound call at all.
record('boot', String(process.pid));

function notFound(hostname) {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
    code: 'ENOTFOUND',
    hostname,
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function recordedFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  record('fetch', url);
  if (LOCAL_HOSTS.has(new URL(url).hostname)) return realFetch(input, init);
  return new Response('offline', { status: 503 });
};

const realLookup = dns.lookup;
dns.lookup = function recordedLookup(hostname, options, callback) {
  record('dns', hostname);
  if (LOCAL_HOSTS.has(hostname)) return realLookup.apply(this, arguments);
  const cb = typeof options === 'function' ? options : callback;
  process.nextTick(() => cb(notFound(hostname)));
  return undefined;
};

const realPromisesLookup = dns.promises.lookup;
dns.promises.lookup = async function recordedPromisesLookup(hostname, options) {
  record('dns', hostname);
  if (LOCAL_HOSTS.has(hostname)) return realPromisesLookup.call(this, hostname, options);
  throw notFound(hostname);
};
