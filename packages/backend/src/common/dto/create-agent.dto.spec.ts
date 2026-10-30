import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateAgentDto } from './create-agent.dto';

describe('CreateAgentDto', () => {
  it('accepts valid agent names', async () => {
    for (const name of ['my-agent', 'agent-1', 'testbot', 'a', 'x'.repeat(63)]) {
      const dto = plainToInstance(CreateAgentDto, { name });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects empty name', async () => {
    const dto = plainToInstance(CreateAgentDto, { name: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing name', async () => {
    const dto = plainToInstance(CreateAgentDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects names that are not DNS labels', async () => {
    for (const name of ['has spaces', 'TestBot', 'agent_1', '-agent', 'agent-']) {
      const dto = plainToInstance(CreateAgentDto, { name });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects names with special characters', async () => {
    const dto = plainToInstance(CreateAgentDto, { name: 'agent@home!' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects names longer than 63 characters', async () => {
    const dto = plainToInstance(CreateAgentDto, { name: 'a'.repeat(64) });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid agent_category and agent_platform', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      agent_category: 'personal',
      agent_platform: 'openclaw',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts app category with sdk platform', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      agent_category: 'app',
      agent_platform: 'openai-sdk',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts coding category with codex platform', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      agent_category: 'coding',
      agent_platform: 'codex',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts other platform', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      agent_category: 'personal',
      agent_platform: 'other',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid agent_category', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      agent_category: 'invalid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid agent_platform', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      agent_platform: 'invalid-platform',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows omitting category and platform', async () => {
    const dto = plainToInstance(CreateAgentDto, { name: 'my-agent' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a boolean record_messages', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      record_messages: true,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.record_messages).toBe(true);
  });

  it('allows omitting record_messages', async () => {
    const dto = plainToInstance(CreateAgentDto, { name: 'my-agent' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.record_messages).toBeUndefined();
  });

  it('rejects non-boolean record_messages', async () => {
    const dto = plainToInstance(CreateAgentDto, {
      name: 'my-agent',
      record_messages: 1,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'record_messages')).toBe(true);
  });
});
