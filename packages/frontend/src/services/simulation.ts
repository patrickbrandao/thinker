import { signal } from '../lib/signal.js';

/**
 * Pure simulation mode (THINKER_SIMULATION=true on the backend): read once
 * from `simulation` in GET /api/v1/health. False until it loads or on failure.
 */
export const simulationSignal = signal<boolean>(false);

let loading: Promise<void> | null = null;

export function loadSimulation(): Promise<void> {
  loading ??= fetch('/api/v1/health', { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { simulation?: unknown } | null) => {
      simulationSignal.set(data?.simulation === true);
    })
    .catch(() => undefined);
  return loading;
}

/** Tests only. */
export function resetSimulationForTests(): void {
  loading = null;
  simulationSignal.set(false);
}
