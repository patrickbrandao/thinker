import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

let cached: string | null | undefined;

/**
 * Release version of this build, read from the canonical
 * `packages/thinker/package.json` (the one scripts/ship.sh bumps). Walks up
 * from this file so it resolves from `src/` (dev, tests) and `dist/` (image)
 * alike. Null when the file is not shipped.
 */
export function thinkerVersion(startDir: string = __dirname): string | null {
  if (cached !== undefined && startDir === __dirname) return cached;
  let dir = startDir;
  let version: string | null = null;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'packages', 'thinker', 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: unknown };
        version = typeof pkg.version === 'string' && pkg.version ? pkg.version : null;
      } catch {
        version = null;
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (startDir === __dirname) cached = version;
  return version;
}
