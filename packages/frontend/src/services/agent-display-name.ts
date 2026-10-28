import { signal } from '../lib/signal.js';

export const agentDisplayNameSignal = signal<string | null>(null);

export function agentDisplayName(): string | null {
  return agentDisplayNameSignal();
}

export function setAgentDisplayName(value: string | null): void {
  agentDisplayNameSignal.set(value);
}
