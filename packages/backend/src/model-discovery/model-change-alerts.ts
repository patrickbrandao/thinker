import type { SystemEventInput } from '../common/services/system-events.service';

/** Per-model alerts past this many changes collapse into one summary. */
export const MAX_MODEL_CHANGE_ALERTS = 20;

interface ConnectionRef {
  id: string;
  tenant_id: string;
  provider: string;
  label?: string | null;
}

/**
 * Alerts for a discovery that replaces `previous` with `next`: the first
 * discovery of a connection is one summary ("N models detected"); later ones
 * report each added and removed model (a summary past
 * MAX_MODEL_CHANGE_ALERTS). An empty new list says nothing (it is ignored
 * upstream, never "every model disappeared").
 */
export function modelChangeAlerts(
  connection: ConnectionRef,
  previous: Array<{ id?: string }> | null | undefined,
  next: Array<{ id?: string }>,
): SystemEventInput[] {
  const nextIds = [...new Set(next.map((m) => m?.id).filter((id): id is string => !!id))];
  if (nextIds.length === 0) return [];
  const label = connection.label ? ` "${connection.label}"` : '';
  const where = `${connection.provider}${label}`;
  const base = {
    tenantId: connection.tenant_id,
    entityType: 'model',
    metadata: {
      connection_id: connection.id,
      provider: connection.provider,
      label: connection.label ?? null,
    },
    vars: {
      'connection.id': connection.id,
      'connection.provider': connection.provider,
      'connection.label': connection.label ?? '',
    },
  };
  const prevIds = new Set((previous ?? []).map((m) => m?.id).filter((id): id is string => !!id));
  if (prevIds.size === 0) {
    return [
      {
        ...base,
        level: 'info',
        type: 'model.added',
        title: `${nextIds.length} model${nextIds.length === 1 ? '' : 's'} detected on ${where}`,
        message: `First discovery of ${where}: ${preview(nextIds)}.`,
        entityType: 'connection',
        entityId: connection.id,
        entityName: where,
        metadata: {
          ...base.metadata,
          first_discovery: true,
          count: nextIds.length,
          models: nextIds.slice(0, 200),
        },
      },
    ];
  }
  const added = nextIds.filter((id) => !prevIds.has(id));
  const nextSet = new Set(nextIds);
  const removed = [...prevIds].filter((id) => !nextSet.has(id));
  const out: SystemEventInput[] = [];
  const each = (ids: string[], type: 'model.added' | 'model.removed') => {
    if (ids.length === 0) return;
    const verb = type === 'model.added' ? 'added to' : 'removed from';
    const level = type === 'model.added' ? 'info' : 'warning';
    if (ids.length > MAX_MODEL_CHANGE_ALERTS) {
      out.push({
        ...base,
        level,
        type,
        title: `${ids.length} models ${verb} ${where}`,
        message: `${preview(ids)}.`,
        entityType: 'connection',
        entityId: connection.id,
        entityName: where,
        metadata: { ...base.metadata, count: ids.length, models: ids.slice(0, 200) },
      });
      return;
    }
    for (const id of ids) {
      out.push({
        ...base,
        level,
        type,
        title: `Model ${id} ${verb} ${where}`,
        message:
          type === 'model.added'
            ? `${where} now offers ${id}.`
            : `${where} no longer lists ${id}. Routes that use it may fail.`,
        entityId: id,
        entityName: id,
      });
    }
  };
  each(added, 'model.added');
  each(removed, 'model.removed');
  return out;
}

function preview(ids: string[]): string {
  const shown = ids.slice(0, 10).join(', ');
  return ids.length > 10 ? `${shown} and ${ids.length - 10} more` : shown;
}
