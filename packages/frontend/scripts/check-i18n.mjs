#!/usr/bin/env node
/**
 * i18n guard for the dashboard (#42). Fails (exit 1) when:
 *  1. a key exists in the English catalog but not in pt-BR (or the reverse),
 *     or the two disagree on shape or on `{{ placeholders }}`;
 *  2. a component renders user-visible text that is not from the catalogs:
 *     JSX text, string literals in visible attributes (placeholder, title,
 *     aria-label, alt, label) or in JSX expressions, and toast messages.
 *
 * Brand and product names and code samples are allowed. Anything else that
 * must stay literal takes an `i18n-ignore` comment on the same or the
 * previous line.
 *
 * Usage: node scripts/check-i18n.mjs [--keys-only]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src/i18n/locales');
const errors = [];

// ---------------------------------------------------------------- 1. keys

function kind(v) {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'function') return 'function';
  if (v && typeof v === 'object') return 'object';
  return typeof v;
}

function placeholders(s) {
  return [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
}

function compare(ref, tr, path, file) {
  for (const key of Object.keys(ref)) {
    const p = path ? `${path}.${key}` : key;
    if (!(key in tr)) {
      errors.push(`${file}: key "${p}" exists in en but is missing in pt-BR`);
      continue;
    }
    const a = kind(ref[key]);
    const b = kind(tr[key]);
    if (a !== b) {
      errors.push(`${file}: key "${p}" is a ${a} in en but a ${b} in pt-BR`);
    } else if (a === 'object') {
      compare(ref[key], tr[key], p, file);
    } else if (a === 'string' && placeholders(ref[key]) !== placeholders(tr[key])) {
      errors.push(`${file}: key "${p}" placeholders differ (en: {{${placeholders(ref[key])}}}, pt-BR: {{${placeholders(tr[key])}}})`);
    }
  }
  for (const key of Object.keys(tr)) {
    if (!(key in ref)) errors.push(`${file}: key "${path ? `${path}.${key}` : key}" exists in pt-BR but not in en`);
  }
}

const namespaces = readdirSync(join(localesDir, 'en')).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
for (const file of namespaces) {
  const en = (await import(pathToFileURL(join(localesDir, 'en', file)).href)).default;
  let pt;
  try {
    pt = (await import(pathToFileURL(join(localesDir, 'pt-BR', file)).href)).default;
  } catch {
    errors.push(`pt-BR/${file}: missing catalog file`);
    continue;
  }
  compare(en, pt, '', file.replace(/\.ts$/, ''));
}

// ------------------------------------------------- 2. hard-coded strings

/** Text that is the same in every language: brands, products, units, code. */
const ALLOWED = new Set(
  `Thinker Claude Code Codex OpenAI Anthropic Gemini Google GitHub Copilot OpenRouter Ollama
  LM Studio llama.cpp vLLM Mistral DeepSeek xAI Grok Groq Qwen Kimi Moonshot MiniMax Z.ai Zhipu GLM
  OpenClaw Hermes OpenCode Nanobot n8n Craft Agent SendGrid Mailgun Resend SMTP MCP CLI API SDK
  JSON YAML HTTP HTTPS URL ID OAuth SSE OTLP BYOK USD ChatGPT Claude Cursor Windsurf Cline LangChain
  Vercel AI Python TypeScript JavaScript Node.js cURL curl Bearer x-api-key Authorization Plus Pro Max
  Team Enterprise Free AWS Bedrock Azure Vertex Cohere Perplexity Together Fireworks Cerebras`
    .split(/\s+/)
    .filter(Boolean),
);
const ALLOWED_PHRASES = new Set([
  'Claude Code', 'LM Studio', 'GitHub Copilot', 'Craft Agent', 'OpenAI SDK', 'Anthropic SDK',
  'Vercel AI SDK', 'Google Gemini', 'Z.ai', 'OpenCode Go', 'Kimi Code', 'MiniMax Coding Plan',
]);

const VISIBLE_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'aria-description']);
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'Title']);

function needsTranslation(raw) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (!/[A-Za-z]{2,}/.test(text)) return false; // symbols, numbers, single letters
  if (ALLOWED_PHRASES.has(text)) return false;
  // Words: every word is an allowed name, a constant, a path, a URL or a version.
  const words = text.split(/[\s/·,()|:+]+/).filter(Boolean);
  return !words.every(
    (w) =>
      ALLOWED.has(w) ||
      /^[A-Z0-9_]{2,}$/.test(w) || // ENV_VAR, HTTP
      /^[\w.-]+\.(com|ai|io|dev|org|json|ts|js|md|sh|yaml|yml)$/.test(w) ||
      /^https?:/.test(w) ||
      /^[$@#~./\\-]/.test(w) ||
      /^v?\d[\w.-]*$/.test(w) ||
      /^[a-z0-9]+([-_][a-z0-9]+)+$/.test(w) || // kebab/snake identifiers
      /[a-z][A-Z]/.test(w), // camelCase identifiers
  );
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p !== join(root, 'src/i18n')) walk(p, out);
    } else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function ignored(source, sf, node) {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const lines = source.split('\n');
  return /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '');
}

function insideCodeTag(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxElement(n)) {
      const tag = n.openingElement.tagName.getText();
      if (CODE_TAGS.has(tag)) return true;
    }
  }
  return false;
}

function report(file, sf, node, text) {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  errors.push(`${relative(root, file)}:${line + 1}:${character + 1}: hard-coded text "${text.replace(/\s+/g, ' ').trim().slice(0, 70)}"`);
}

/** String literal reached from a JSX expression through ?:, ??, || or (). */
function visibleLiteralsOf(expr, out = []) {
  if (!expr) return out;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) out.push(expr);
  else if (ts.isTemplateExpression(expr)) out.push(expr);
  else if (ts.isConditionalExpression(expr)) {
    visibleLiteralsOf(expr.whenTrue, out);
    visibleLiteralsOf(expr.whenFalse, out);
  } else if (ts.isBinaryExpression(expr) && ['??', '||', '&&'].includes(expr.operatorToken.getText())) {
    visibleLiteralsOf(expr.right, out);
  } else if (ts.isParenthesizedExpression(expr)) visibleLiteralsOf(expr.expression, out);
  return out;
}

function literalText(node) {
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
  return node.text;
}

if (!process.argv.includes('--keys-only')) {
  for (const file of walk(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        if (needsTranslation(node.text) && !insideCodeTag(node) && !ignored(source, sf, node)) report(file, sf, node, node.text);
      } else if (ts.isJsxAttribute(node) && VISIBLE_ATTRS.has(node.name.getText())) {
        const init = node.initializer;
        const lits = !init ? [] : ts.isStringLiteral(init) ? [init] : ts.isJsxExpression(init) ? visibleLiteralsOf(init.expression) : [];
        for (const lit of lits) {
          if (needsTranslation(literalText(lit)) && !ignored(source, sf, lit)) report(file, sf, lit, literalText(lit));
        }
      } else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        for (const lit of visibleLiteralsOf(node.expression)) {
          if (needsTranslation(literalText(lit)) && !insideCodeTag(node) && !ignored(source, sf, lit)) report(file, sf, lit, literalText(lit));
        }
      } else if (
        ts.isCallExpression(node) &&
        /^toast\.(success|error|info|warning)$/.test(node.expression.getText()) &&
        node.arguments[0]
      ) {
        for (const lit of visibleLiteralsOf(node.arguments[0])) {
          if (needsTranslation(literalText(lit)) && !ignored(source, sf, lit)) report(file, sf, lit, literalText(lit));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

if (errors.length) {
  console.error(`check-i18n: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check-i18n: ${namespaces.length} namespaces, en and pt-BR in sync, no hard-coded text`);
