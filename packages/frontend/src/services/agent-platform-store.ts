import { platformIcon } from 'thinker-shared';
import { signal } from '../lib/signal.js';

export const agentPlatformSignal = signal<{ platform: string | null; category: string | null }>({
  platform: null,
  category: null,
});

export function agentPlatform(): string | null {
  return agentPlatformSignal().platform;
}

export function setAgentPlatform(value: string | null, cat?: string | null): void {
  agentPlatformSignal.set((prev) => ({
    platform: value,
    category: cat !== undefined ? cat : prev.category,
  }));
}

export function agentCategory(): string | null {
  return agentPlatformSignal().category;
}

export function agentPlatformIcon(): string | undefined {
  const { platform, category } = agentPlatformSignal();
  return platformIcon(platform, category);
}
