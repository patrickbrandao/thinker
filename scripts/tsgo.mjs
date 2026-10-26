#!/usr/bin/env node
// Runs the TypeScript 7 native compiler (tsgo), installed under the npm
// alias `@typescript/native` (= typescript@7). It is used only for
// `typecheck:ts7` (--noEmit); emit, tests, lint and migrations stay on
// TypeScript 6 (`tsc6`, from the `typescript` alias). See #87.
//
// The binary is resolved through Node instead of `node_modules/.bin/tsc`
// because both `typescript@7` and the TS 6 package behind
// `@typescript/typescript6` declare a `tsc` bin, and npm links whichever
// it reaches last. Never call a bare `tsc` in this repo.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// `bin/tsc` is not in the package's "exports"; locate it from package.json.
const pkgJson = require.resolve('@typescript/native/package.json');
const { bin: bins, version } = require(pkgJson);
if (!version.startsWith('7.')) {
  console.error(`scripts/tsgo.mjs: expected TypeScript 7 under @typescript/native, found ${version}.`);
  process.exit(2);
}
const bin = join(dirname(pkgJson), bins.tsc);
const args = process.argv.slice(2);

if (!args.includes('--noEmit')) {
  console.error('scripts/tsgo.mjs: only --noEmit runs are allowed (emit stays on TypeScript 6).');
  process.exit(2);
}

const result = spawnSync(process.execPath, [bin, ...args], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
