import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPricingSnapshot } from './pricing-snapshot';

describe('loadPricingSnapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pricing-snapshot-'));

  it('returns null when the image has no snapshot', () => {
    expect(loadPricingSnapshot(join(dir, 'missing.json'))).toBeNull();
  });

  it('parses a snapshot written by docker/pricing-snapshot.mjs', () => {
    const path = join(dir, 'ok.json');
    writeFileSync(
      path,
      JSON.stringify({
        generatedAt: '2026-10-26T12:00:00.000Z',
        openrouter: [
          { id: 'openai/gpt-x', pricing: { prompt: '0.000001', completion: '0.000002' } },
        ],
        modelsDev: { openai: { id: 'openai', models: {} } },
      }),
    );
    const snapshot = loadPricingSnapshot(path);
    expect(snapshot?.generatedAt.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(snapshot?.openrouter).toHaveLength(1);
    expect(snapshot?.modelsDev).toHaveProperty('openai');
  });

  it('ignores a malformed snapshot', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{"generatedAt":"nope","openrouter":{}}');
    expect(loadPricingSnapshot(path)).toBeNull();
  });
});
