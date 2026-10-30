import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DuplicateAgentDto } from './duplicate-agent.dto';

/**
 * DuplicateAgentDto guards the POST body for the duplicate-agent endpoint.
 * Names are DNS labels (AGENT_NAME_PATTERN): lowercase letters, digits and
 * inner hyphens, at most 63 characters.
 */
describe('DuplicateAgentDto', () => {
  const buildErrors = (name: unknown) => validate(plainToInstance(DuplicateAgentDto, { name }));

  it('accepts valid agent names', async () => {
    for (const name of ['my-agent', 'agent-1', 'testbot', 'a', 'bot-copy', 'a'.repeat(63)]) {
      const errors = await buildErrors(name);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects an empty string', async () => {
    const errors = await buildErrors('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing name (required field)', async () => {
    const errors = await validate(plainToInstance(DuplicateAgentDto, {}));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects names longer than 63 characters', async () => {
    const errors = await buildErrors('a'.repeat(64));
    expect(errors.some((e) => e.constraints?.['maxLength'])).toBe(true);
  });

  it('rejects names containing a slash (regex-disallowed)', async () => {
    const errors = await buildErrors('bot/copy');
    expect(errors.some((e) => e.constraints?.['matches'])).toBe(true);
  });

  it('rejects names with other special characters', async () => {
    for (const name of ['agent@home', 'bot!', 'a:b', 'name.with.dots']) {
      const errors = await buildErrors(name);
      expect(errors.some((e) => e.constraints?.['matches'])).toBe(true);
    }
  });

  it('rejects non-ASCII letters (regex is ASCII-only)', async () => {
    const errors = await buildErrors('café');
    expect(errors.some((e) => e.constraints?.['matches'])).toBe(true);
  });

  it('rejects a non-string name', async () => {
    const errors = await buildErrors(123);
    expect(errors.some((e) => e.constraints?.['isString'])).toBe(true);
  });

  it('rejects uppercase, spaces, underscores and edge hyphens', async () => {
    for (const name of ['TestBot', 'Bot Copy', 'agent_1', '-agent', 'agent-', '   ']) {
      const errors = await buildErrors(name);
      expect(errors.some((e) => e.constraints?.['matches'])).toBe(true);
    }
  });
});
