// Build-time pricing snapshot (#73). Downloads the public OpenRouter and
// models.dev catalogs (ADR 0003) and writes the fields the backend's pricing
// sync reads, so an image running with THINKER_CATALOG_SYNC=false (or offline)
// still costs requests at the prices of its build day. Runs only while the
// image is built, never at runtime. Any failure leaves no snapshot behind and
// the build goes on: the backend then behaves as before.
//
// Usage: node pricing-snapshot.mjs <output.json>
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node pricing-snapshot.mjs <output.json>');
  process.exit(1);
}

const TIMEOUT_MS = 30000;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function pick(obj, keys) {
  const result = {};
  for (const key of keys) if (obj?.[key] !== undefined) result[key] = obj[key];
  return result;
}

try {
  const [openrouter, modelsDev] = await Promise.all([
    getJson('https://openrouter.ai/api/v1/models'),
    getJson('https://models.dev/api.json'),
  ]);

  const openrouterModels = (openrouter.data ?? []).map((m) => ({
    ...pick(m, ['id', 'name', 'context_length']),
    architecture: pick(m.architecture, ['input_modalities', 'output_modalities']),
    pricing: pick(m.pricing, ['prompt', 'completion']),
  }));

  const modelFields = [
    'id',
    'name',
    'family',
    'reasoning',
    'tool_call',
    'structured_output',
    'cost',
    'limit',
    'modalities',
  ];
  const providers = {};
  for (const [providerId, provider] of Object.entries(modelsDev)) {
    if (!provider?.models) continue;
    const models = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      models[modelId] = pick(model, modelFields);
    }
    providers[providerId] = { ...pick(provider, ['id', 'name']), models };
  }

  if (openrouterModels.length === 0 || Object.keys(providers).length === 0) {
    throw new Error('a catalog came back empty');
  }

  writeFileSync(
    out,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      openrouter: openrouterModels,
      modelsDev: providers,
    }),
  );
  console.log(
    `Pricing snapshot: ${openrouterModels.length} OpenRouter models, ${Object.keys(providers).length} models.dev providers -> ${out}`,
  );
} catch (err) {
  console.warn(`Pricing snapshot skipped: ${err instanceof Error ? err.message : err}`);
}
