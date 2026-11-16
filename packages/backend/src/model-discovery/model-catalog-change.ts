/**
 * Model ids a discovery added to or removed from one connection's list. The
 * discovery module cannot depend on routing (circular), so routing registers
 * a listener here, as alert-sink does for alerts.
 */
export interface ModelCatalogChange {
  connection: {
    id: string;
    tenant_id: string;
    provider: string;
    auth_type: string;
    label: string | null;
  };
  added: string[];
  removed: string[];
}

type Listener = (change: ModelCatalogChange) => void | Promise<void>;
let listener: Listener | null = null;

export function setModelCatalogChangeListener(next: Listener | null): void {
  listener = next;
}

/** Diff of two model lists by id; empty on a first discovery or an empty new list. */
export function diffModelIds(
  previous: Array<{ id?: string }> | null | undefined,
  next: Array<{ id?: string }>,
): { added: string[]; removed: string[] } {
  const ids = (list: Array<{ id?: string }>) =>
    new Set(list.map((m) => m?.id).filter((id): id is string => !!id));
  const prev = ids(previous ?? []);
  const curr = ids(next);
  if (prev.size === 0 || curr.size === 0) return { added: [], removed: [] };
  return {
    added: [...curr].filter((id) => !prev.has(id)),
    removed: [...prev].filter((id) => !curr.has(id)),
  };
}

/** Never throws and never awaits the listener: discovery must not wait on it. */
export function notifyModelCatalogChange(change: ModelCatalogChange): void {
  if (!listener || (change.added.length === 0 && change.removed.length === 0)) return;
  try {
    void Promise.resolve(listener(change)).catch(() => undefined);
  } catch {
    // Listeners never break discovery.
  }
}
