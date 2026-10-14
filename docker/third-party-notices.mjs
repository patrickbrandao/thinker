// Writes THIRD_PARTY_NOTICES for the production image: name, version,
// declared license and license text of every package installed under
// node_modules. Runs inside the Docker build, after the production-only
// `npm ci` and before node_modules is pruned (the pruning deletes LICENSE
// files). Offline: it only reads the filesystem.
//
// Usage: node third-party-notices.mjs <app-root> <output-file>

import { readdirSync, readFileSync, writeFileSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [root = '.', output = 'THIRD_PARTY_NOTICES'] = process.argv.slice(2);
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

const seen = new Map();

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  }
  return 'UNKNOWN';
}

function licenseTexts(dir) {
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && lstatSync(join(dir, f)).isFile())
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
}

function visitPackage(dir) {
  const pkgJsonPath = join(dir, 'package.json');
  if (!existsSync(pkgJsonPath)) return;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  if (pkg.name && pkg.version) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), texts: licenseTexts(dir) });
    }
  }
  walkNodeModules(join(dir, 'node_modules'));
}

function walkNodeModules(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    // Workspace packages are symlinks to our own code, not third-party.
    if (lstatSync(full).isSymbolicLink() || !lstatSync(full).isDirectory()) continue;
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(full).sort()) {
        const scopedDir = join(full, scoped);
        if (lstatSync(scopedDir).isSymbolicLink()) continue;
        visitPackage(scopedDir);
      }
    } else {
      visitPackage(full);
    }
  }
}

walkNodeModules(join(root, 'node_modules'));
const workspaces = join(root, 'packages');
if (existsSync(workspaces)) {
  for (const ws of readdirSync(workspaces).sort()) {
    walkNodeModules(join(workspaces, ws, 'node_modules'));
  }
}

const packages = [...seen.values()].sort((a, b) =>
  a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
);

let out =
  'THIRD-PARTY SOFTWARE NOTICES\n\n' +
  'This image includes the third-party packages listed below, each under its\n' +
  'own license. Thinker itself is licensed under the MIT license in /app/LICENSE.\n';
for (const p of packages) {
  out += `\n${'='.repeat(78)}\n${p.name}@${p.version}\nLicense: ${p.license}\n${'-'.repeat(78)}\n`;
  out += p.texts.length > 0 ? `${p.texts.join('\n\n')}\n` : '(no license file shipped with the package)\n';
}
writeFileSync(output, out);
console.log(`THIRD_PARTY_NOTICES: ${packages.length} packages`);
