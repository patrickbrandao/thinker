import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { getModelPrices } from '../services/api.js';
import { resolveProviderId } from '../services/routing-utils.js';
import { PROVIDERS } from '../services/providers.js';
import { useResource } from '../lib/use-resource.js';
import { providerIcon } from './ProviderIcon.js';
import { t } from '../i18n/index.js';

interface ModelPricesData {
  models: { model_name: string; provider: string }[];
  lastSyncedAt: string | null;
}

interface ModelSelectDropdownProps {
  selectedValue: string | null;
  onSelect: (cliValue: string, displayLabel: string) => void;
}

function computeCliValue(modelName: string, provider: string): string {
  const providerId = provider.toLowerCase();
  return modelName.startsWith(`${providerId}/`) ? modelName : `${providerId}/${modelName}`;
}

/** Resolve a display label for a model name from the PROVIDERS definitions. */
function labelForModel(name: string): string {
  for (const prov of PROVIDERS) {
    for (const m of prov.models) {
      if (m.value === name) return m.label;
    }
  }
  const slash = name.indexOf('/');
  if (slash !== -1) {
    const bare = name.substring(slash + 1);
    for (const prov of PROVIDERS) {
      for (const m of prov.models) {
        if (m.value === bare) return m.label;
      }
    }
    return bare;
  }
  return name;
}

type GroupModel = { value: string; label: string; cliValue: string };
type Group = { provId: string; name: string; models: GroupModel[] };

function groupModels(d: ModelPricesData | undefined, search: string): Group[] {
  if (!d?.models) return [];
  const q = search.toLowerCase().trim();
  const groupMap = new Map<string, Group>();

  for (const m of d.models) {
    const provId = resolveProviderId(m.provider);
    if (!provId) continue;
    if (!groupMap.has(provId)) {
      const provDef = PROVIDERS.find((p) => p.id === provId);
      groupMap.set(provId, { provId, name: provDef?.name ?? m.provider, models: [] });
    }
    groupMap.get(provId)!.models.push({
      value: m.model_name,
      label: labelForModel(m.model_name),
      cliValue: computeCliValue(m.model_name, m.provider),
    });
  }

  const groups: Group[] = [];
  for (const group of groupMap.values()) {
    if (q) {
      const nameMatch = group.name.toLowerCase().includes(q);
      const filtered = nameMatch
        ? group.models
        : group.models.filter(
            (m) => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q),
          );
      if (filtered.length > 0) groups.push({ ...group, models: filtered });
    } else if (group.models.length > 0) {
      groups.push(group);
    }
  }
  return groups;
}

/**
 * Inline searchable model list grouped by provider. The `routing-modal__*`
 * classes are stable test hooks.
 */
export default function ModelSelectDropdown(props: ModelSelectDropdownProps) {
  const data = useResource(() => getModelPrices() as Promise<ModelPricesData>, []);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const groups = groupModels(data.data, search);

  const handleSelect = (cliValue: string, label: string) => {
    props.onSelect(cliValue, label);
    setOpen(false);
    setSearch('');
  };

  const handleReopen = () => {
    setOpen(true);
    setSearch('');
  };

  return (
    <div className="flex flex-col gap-2">
      {!open && props.selectedValue ? (
        <button
          className="routing-modal__selected-display field flex h-auto cursor-pointer flex-col items-start gap-0.5 py-2 text-left"
          onClick={handleReopen}
          type="button"
          aria-label={t('models.dropdown.change')}
        >
          <span className="font-medium text-ink">
            {labelForModel(props.selectedValue.split('/').pop()!)}
          </span>
          <span className="text-xs text-muted">{t('models.dropdown.clickToChange')}</span>
        </button>
      ) : null}

      {open ? (
        <>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
            />
            <input
              ref={searchRef}
              className="routing-modal__search field pl-8"
              type="text"
              placeholder={t('models.searchPlaceholder')}
              aria-label={t('models.dropdown.searchLabel')}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>

          {data.loading ? (
            <div className="routing-modal__empty py-6 text-center text-sm text-muted">
              {t('models.dropdown.loading')}
            </div>
          ) : null}

          {!data.loading && data.data ? (
            <div className="routing-modal__list max-h-80 overflow-y-auto rounded-control border border-line">
              {groups.map((group) => (
                <div key={group.provId} className="routing-modal__group">
                  <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-s2 px-3 py-1.5 text-xs font-semibold text-muted">
                    <span className="inline-flex">{providerIcon(group.provId, 16)}</span>
                    <span className="routing-modal__group-name">{group.name}</span>
                  </div>
                  {group.models.map((model) => (
                    <button
                      key={model.cliValue}
                      className="routing-modal__model flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-3 py-2 text-left hover:bg-s2"
                      onClick={() => handleSelect(model.cliValue, model.label)}
                      type="button"
                    >
                      <span className="routing-modal__model-label truncate text-sm text-ink">
                        {model.label}
                      </span>
                      <span className="truncate font-mono text-xs text-faint">{model.value}</span>
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 ? (
                <div className="routing-modal__empty py-6 text-center text-sm text-muted">
                  {t('models.noSearchMatch')}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export { computeCliValue, labelForModel };
