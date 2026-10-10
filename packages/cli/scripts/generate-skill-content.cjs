#!/usr/bin/env node
'use strict';
/**
 * Embeds the CLI's agent skill (packages/cli/skill/SKILL.md) into
 * src/skill-content.gen.ts so `mnfst skill show|install` can hand it to an
 * agent without shipping a data file or reading the repo at runtime.
 *
 * Runs as part of `npm run build`; the output is committed. The drift spec
 * (skill-content.spec.ts) fails whenever the committed copy is stale, and CI
 * additionally diffs the file after rebuilding.
 */
const fs = require('fs');
const path = require('path');

/**
 * Lives inside the package, not under the repo's .claude/skills/, so Claude
 * Code sessions working on this repo don't auto-load it. The rebranded
 * thinker-cli skill is tracked in issue #23.
 */
const SKILL_PATH = path.join(__dirname, '..', 'skill', 'SKILL.md');

/** The skill markdown as committed — the single source of truth. */
function readSkillMarkdown() {
  return fs.readFileSync(SKILL_PATH, 'utf8');
}

/** The CLI version the skill ships with (packages/cli/package.json). */
function readSkillVersion() {
  return require(path.join(__dirname, '..', 'package.json')).version;
}

async function main() {
  const markdown = readSkillMarkdown();
  const version = readSkillVersion();
  const out = `// GENERATED FILE — do not edit by hand.
// Source: packages/cli/skill/SKILL.md.
// Refresh with: npm run gen (runs automatically in npm run build).

/** The mnfst agent skill, embedded so the CLI can install it anywhere. */
export const SKILL_MD: string = ${JSON.stringify(markdown)};

/** The CLI version this copy of the skill shipped with. */
export const SKILL_VERSION = ${JSON.stringify(version)};
`;
  const dest = path.join(__dirname, '..', 'src', 'skill-content.gen.ts');
  // Format with the repo's prettier config before writing, for the same reason
  // the catalog generator does: the pre-commit hook prettifies src/**/*.ts, so
  // an unformatted write would differ from the committed file and break CI's
  // `git diff --exit-code` drift gate on content that is actually current.
  const prettier = require('prettier');
  const config = await prettier.resolveConfig(dest);
  fs.writeFileSync(dest, await prettier.format(out, { ...config, filepath: dest }));
  console.log(`wrote ${dest}: ${markdown.length} chars of SKILL.md`);
}

module.exports = { readSkillMarkdown, readSkillVersion, SKILL_PATH };
if (require.main === module) main();
