/**
 * #16: Thinker makes no call to Manifest's hosted healer. Upstream pinged
 * `autofix.manifest.build` on every production boot (AutofixHealthProbe) and on
 * every repairable 4xx (the heal-once flow). Both are gone; this guards against
 * either coming back.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers';

const HEALER_HOST = 'autofix.manifest.build';
const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js|json|ya?ml)$/.test(entry) ? [path] : [];
  });
}

describe('no Autofix egress', () => {
  it('names the hosted healer nowhere in the backend source', () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes(HEALER_HOST),
    );
    expect(offenders).toEqual([]);
  });

  it('ships no boot-time healer probe or healing client', () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /AutofixHealthProbe|HttpHealingClient|HEALING_CLIENT|ObservationReporter/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  describe('at boot', () => {
    let app: INestApplication | undefined;
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];

    beforeAll(async () => {
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        urls.push(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        return originalFetch(input, init);
      }) as typeof fetch;
      app = await createTestApp();
    });

    afterAll(async () => {
      await app?.close();
      globalThis.fetch = originalFetch;
    });

    it('makes no request to the hosted healer while the app boots', () => {
      expect(urls.filter((url) => url.includes(HEALER_HOST))).toEqual([]);
    });
  });
});
