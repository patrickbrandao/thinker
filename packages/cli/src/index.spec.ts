import * as fs from 'fs';
import * as path from 'path';
import { COMMANDS, resolveCommand, run, USAGE } from './index';
import { VERSION } from './version';
import { makeIo } from '../test/helpers';

describe('resolveCommand', () => {
  it('prefers the longest matching verb path', () => {
    expect(resolveCommand(['routing', 'virtual', 'create', 'coding'])).toEqual({
      handler: COMMANDS['routing virtual create'],
      key: 'routing virtual create',
      rest: ['coding'],
    });
    expect(resolveCommand(['agent', 'list', '--include-playground'])).toEqual({
      handler: COMMANDS['agent list'],
      key: 'agent list',
      rest: ['--include-playground'],
    });
    expect(resolveCommand(['whoami'])).toEqual({
      handler: COMMANDS['whoami'],
      key: 'whoami',
      rest: [],
    });
  });

  it('returns null for unknown commands, including prototype members', () => {
    expect(resolveCommand(['nope'])).toBeNull();
    expect(resolveCommand(['toString'])).toBeNull();
    expect(resolveCommand(['constructor'])).toBeNull();
  });
});

describe('run', () => {
  it('prints usage on no args, help, and --help', async () => {
    for (const argv of [[], ['help'], ['--help']]) {
      const io = makeIo();
      expect(await run(io, argv as string[])).toBe(0);
      expect(io.lines[0]).toBe(USAGE);
    }
  });

  it('prints the version', async () => {
    const io = makeIo();
    expect(await run(io, ['--version'])).toBe(0);
    expect(io.lastJson()).toEqual({ version: VERSION });
  });

  it('reports unknown commands as error JSON with exit 1', async () => {
    const io = makeIo();
    expect(await run(io, ['frobnicate', 'now'])).toBe(1);
    expect(io.lastJson()).toEqual({
      error: 'unknown_command',
      message: 'Unknown command: frobnicate now',
      hint: 'Run thinker --help',
    });
  });

  it('serializes CliError to the stable error contract', async () => {
    const io = makeIo();
    expect(await run(io, ['agent', 'delete', 'x'])).toBe(1);
    expect(io.lastJson()).toEqual({
      error: 'confirmation_required',
      message: 'Refusing to delete agent "x" without --yes',
      hint: 'Re-run with --yes to authorize this destructive operation',
    });
  });

  it('wraps unexpected exceptions as internal_error', async () => {
    const io = makeIo();
    // Corrupt config triggers CliError; force a non-CliError instead via a
    // fetch that throws a plain object (client wraps Errors, so break JSON).
    const originalStringify = JSON.stringify.bind(JSON);
    const spy = jest
      .spyOn(JSON, 'stringify')
      .mockImplementation((value: unknown, ...rest: unknown[]) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          'path' in (value as Record<string, unknown>)
        ) {
          throw new Error('boom');
        }
        return originalStringify(value as never, ...(rest as [never, never]));
      });
    try {
      expect(await run(io, ['config', 'path'])).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(io.lastJson()).toMatchObject({ error: 'internal_error', message: 'boom' });
  });

  it('sends only the command request: no usage report, no spool on disk (#17)', async () => {
    const urls: string[] = [];
    const io = makeIo({
      env: { THINKER_URL: 'http://localhost:2099', THINKER_API_KEY: 'k' },
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    for (const ok of [true, false]) {
      if (!ok) io.env['THINKER_API_KEY'] = '';
      await run(io, ['agent', 'list']);
    }
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('http://localhost:2099/'))).toBe(true);
    const written = fs.readdirSync(io.configDir, { recursive: true }).map(String);
    expect(written.filter((name) => /telemetry/.test(name))).toEqual([]);
  });

  it('sends an env key only to the local default when no host is configured (#17)', async () => {
    const calls: Array<{ url: string; key: string | undefined }> = [];
    const io = makeIo({
      env: { THINKER_API_KEY: 'env-key' },
      fetchImpl: async (input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url: String(input), key: headers['X-API-Key'] });
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(await run(io, ['agent', 'list'])).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url.startsWith('http://localhost:2099/')).toBe(true);
    }
    expect(calls[0].key).toBe('env-key');
  });

  it('usage documents every registered command group', () => {
    for (const key of Object.keys(COMMANDS)) {
      const firstWord = key.split(' ')[0];
      expect(USAGE).toContain(firstWord);
    }
  });

  it('usage advertises only flags the commands actually accept', () => {
    // `enable` has no --yes (nothing destructive to confirm); `disable` requires it.
    expect(USAGE).toContain(
      'thinker agent provider enable <name> <provider> [--auth-type <a>] [--label <l>]\n',
    );
    expect(USAGE).toContain('thinker agent provider disable <name> <provider>');
    expect(USAGE).toMatch(/agent provider disable[^\n]*--yes/);
    // Flags that existed but went undocumented.
    expect(USAGE).toMatch(/agent configure[^\n]*--key-label/);
    expect(USAGE).toMatch(/provider custom add[^\n]*--agent <name>/);
    expect(USAGE).toMatch(/provider custom list \[--agent <name>\]/);
    expect(USAGE).toMatch(/provider custom remove[^\n]*--agent <name>/);
    expect(USAGE).toMatch(/agent key show <name> \[--raw\]/);
    // --enabled belongs to `set`, not `get`.
    expect(USAGE).toContain(
      'thinker routing recording get <agent> | thinker routing recording set <agent> --enabled true|false',
    );
    expect(USAGE).toContain(
      'thinker routing params get <agent> [--tier <t> | --virtual <v>] [--model <m>]\n',
    );
    // Virtual models: create/update take routes, delete confirms, enable/disable toggle.
    expect(USAGE).toMatch(
      /routing virtual create <agent> --name <n>[^\n]*--fallback <m> \.\.\.[^\n]*--continue-on-default/,
    );
    expect(USAGE).toMatch(
      /routing virtual update <agent> <name>[^\n]*--\[no-\]continue-on-default/,
    );
    expect(USAGE).toContain('thinker routing virtual delete <agent> <name> --yes\n');
    expect(USAGE).toContain('thinker routing virtual enable|disable <agent> <name>\n');
    expect(USAGE).toMatch(
      /routing params set <agent>[^\n]*--set <path>=<value>[^\n]*--unset <path>/,
    );
  });

  it('usage carries no telemetry notice: the CLI reports nothing (#17)', () => {
    expect(USAGE).not.toMatch(/telemetry/i);
  });
});

describe('version constant', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.version).toBe(VERSION);
  });
});
