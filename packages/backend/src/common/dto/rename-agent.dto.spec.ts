import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RenameAgentDto } from './rename-agent.dto';

describe('RenameAgentDto', () => {
  it('accepts valid agent names', async () => {
    for (const name of ['my-agent', 'agent-1', 'testbot', 'a', 'x'.repeat(63)]) {
      const dto = plainToInstance(RenameAgentDto, { name });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects empty name', async () => {
    const dto = plainToInstance(RenameAgentDto, { name: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows missing name (optional)', async () => {
    const dto = plainToInstance(RenameAgentDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects names that are not DNS labels', async () => {
    for (const name of ['has spaces', 'TestBot', 'agent_1', '-agent', 'agent-']) {
      const dto = plainToInstance(RenameAgentDto, { name });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects names with special characters', async () => {
    const dto = plainToInstance(RenameAgentDto, { name: 'agent@home!' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects names longer than 63 characters', async () => {
    const dto = plainToInstance(RenameAgentDto, { name: 'a'.repeat(64) });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid agent_category', async () => {
    const dto = plainToInstance(RenameAgentDto, { agent_category: 'personal' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid agent_category', async () => {
    const dto = plainToInstance(RenameAgentDto, { agent_category: 'invalid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid agent_platform', async () => {
    const dto = plainToInstance(RenameAgentDto, { agent_platform: 'openclaw' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid agent_platform', async () => {
    const dto = plainToInstance(RenameAgentDto, { agent_platform: 'invalid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
