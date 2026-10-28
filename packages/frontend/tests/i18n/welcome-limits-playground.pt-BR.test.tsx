import { describe, it } from 'vitest';

// This file has no Welcome case: the onboarding wizard is covered by
// tests/pages/Welcome.test.ts (welcome-helpers). Limits, LimitRuleModal,
// LimitRuleTable and the Playground components are not ported to React in
// this worktree; their pt-BR cases come back as real tests when they are
// (restore them from git history: `git show main:<this file>`).
describe('Guardrails and Playground in pt-BR', () => {
  it.todo('renders the Limits page in Portuguese with localized currency');
  it.todo('renders the limit rule modal in Portuguese');
  it.todo('switches language live');
  it.todo('renders the Playground history sidebar and prompt in Portuguese');
  it.todo('renders request header warnings in Portuguese');
});
