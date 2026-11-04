import { detectHarnessSession } from './harness-session';

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
});
