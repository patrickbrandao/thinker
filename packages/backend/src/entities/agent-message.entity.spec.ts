import { getMetadataArgsStorage } from 'typeorm';
import { AgentMessage } from './agent-message.entity';

describe('AgentMessage schema mapping', () => {
  it('keeps the legacy physical table name and maps no repair columns', () => {
    const metadata = getMetadataArgsStorage();
    const table = metadata.tables.find((entry) => entry.target === AgentMessage);
    const repairColumns = metadata.columns.filter(
      (entry) =>
        entry.target === AgentMessage &&
        /^auto_?fix/i.test(String(entry.options.name ?? entry.propertyName)),
    );

    expect(table?.name).toBe('agent_messages');
    expect(repairColumns).toEqual([]);
  });

  it('keeps the new request linkage nullable for legacy writers', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (entry) => entry.target === AgentMessage,
    );
    const column = (propertyName: string) =>
      columns.find((entry) => entry.propertyName === propertyName)?.options;

    expect(column('request_id')?.nullable).toBe(true);
    expect(column('attempt_number')?.nullable).toBe(true);
  });
});
