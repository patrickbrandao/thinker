import { detectHarnessSession, stripHarnessPrivateFields } from './harness-session';

describe('detectHarnessSession', () => {
  it('returns null without a session header', () => {
    expect(detectHarnessSession(null)).toBeNull();
    expect(detectHarnessSession({ 'user-agent': 'curl' })).toBeNull();
    expect(detectHarnessSession({ 'x-session-key': 'default' })).toBeNull();
  });

  it('reads OpenCode sessions and their parent', () => {
    expect(
      detectHarnessSession({
        'x-opencode-session-id': 'ses_child',
        'x-session-id': 'ses_child',
        'x-opencode-parent-session-id': 'ses_main',
      }),
    ).toEqual({ id: 'ses_child', parentId: 'ses_main' });
    expect(detectHarnessSession({ 'x-opencode-session': 'ses_a' })).toEqual({
      id: 'ses_a',
      parentId: null,
    });
  });

  it('reads Claude Code, OpenClaw and Hermes headers', () => {
    expect(detectHarnessSession({ 'x-claude-code-session-id': 'cc-1' })?.id).toBe('cc-1');
    expect(detectHarnessSession({ 'x-openclaw-session-key': 'oc-1' })?.id).toBe('oc-1');
    expect(detectHarnessSession({ 'x-hermes-session-id': 'h-1' })?.id).toBe('h-1');
  });

  it('prefers the explicit x-session-key', () => {
    expect(
      detectHarnessSession({ 'x-session-key': 'mine', 'x-claude-code-session-id': 'cc' })?.id,
    ).toBe('mine');
  });

  it('reads x-client-request-id only from Codex', () => {
    expect(detectHarnessSession({ 'x-client-request-id': 'r1' })).toBeNull();
    expect(
      detectHarnessSession({ originator: 'codex_cli_rs', 'x-client-request-id': 'conv-1' })?.id,
    ).toBe('conv-1');
    expect(detectHarnessSession({ session_id: 'codex-old' })?.id).toBe('codex-old');
  });

  it('ignores a parent equal to the session itself', () => {
    expect(
      detectHarnessSession({ 'x-opencode-session-id': 's', 'x-parent-session-id': 's' }),
    ).toEqual({ id: 's', parentId: null });
  });
  it('makes a Claude Code subagent a child of the main session', () => {
    expect(
      detectHarnessSession({ 'x-claude-code-session-id': 'cc-1', 'x-claude-code-agent-id': 'a7' }),
    ).toEqual({ id: 'cc-1:a7', parentId: 'cc-1' });
    // Nested agents fold into the main session too.
    expect(
      detectHarnessSession({
        'x-claude-code-session-id': 'cc-1',
        'x-claude-code-agent-id': 'a8',
        'x-claude-code-parent-agent-id': 'a7',
      }),
    ).toEqual({ id: 'cc-1:a8', parentId: 'cc-1' });
    // An explicit x-session-key wins and keeps its own semantics.
    expect(
      detectHarnessSession({
        'x-session-key': 'mine',
        'x-claude-code-session-id': 'cc-1',
        'x-claude-code-agent-id': 'a7',
      }),
    ).toEqual({ id: 'mine', parentId: null });
  });

  it('reads Codex, DeepSeek Harness and Open WebUI session headers', () => {
    expect(
      detectHarnessSession({ 'session-id': 'cx', 'x-codex-parent-thread-id': 'cx-main' }),
    ).toEqual({ id: 'cx', parentId: 'cx-main' });
    expect(detectHarnessSession({ 'x-deepseek-harness-session-id': 'd-1' })?.id).toBe('d-1');
    expect(detectHarnessSession({ 'x-openwebui-chat-id': 'chat-1' })?.id).toBe('chat-1');
  });
});

describe('stripHarnessPrivateFields', () => {
  it('drops DeepSeek Harness dsh_* fields and keeps the rest', () => {
    const body: Record<string, unknown> = {
      model: 'm',
      dsh_session_log: 'x',
      dsh_plugin_packages: [],
    };
    stripHarnessPrivateFields(body);
    expect(body).toEqual({ model: 'm' });
  });
});
