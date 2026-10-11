/**
 * Preloaded (`node -r`, after `egress-recorder.cjs`) into the servers that
 * `mcp-cimd-ssrf.e2e-spec.ts` boots. Resolves the hostname named by
 * `CIMD_PINNED_HOST` to 127.0.0.1, so a public-looking CIMD `client_id` URL
 * resolves to a private (loopback) address without depending on real DNS.
 * Every other lookup goes to the previous resolver unchanged.
 */
'use strict';

const dns = require('dns');

const pinnedHost = process.env.CIMD_PINNED_HOST;
if (!pinnedHost) throw new Error('CIMD_PINNED_HOST is required');

const pinned = { address: '127.0.0.1', family: 4 };
const previousPromisesLookup = dns.promises.lookup;
dns.promises.lookup = async function pinnedPromisesLookup(hostname, options) {
  if (hostname === pinnedHost) {
    const all = typeof options === 'object' && options !== null && options.all === true;
    return all ? [pinned] : pinned;
  }
  return previousPromisesLookup.call(this, hostname, options);
};
