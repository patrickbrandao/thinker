import type { MouseEvent } from 'react';
import {
  CANONICAL_LOCAL_IDS,
  SHARED_PROVIDER_BY_ID_OR_ALIAS,
  normalizeProviderName,
} from 'thinker-shared';
import type { AuthType, CustomProviderData } from '../services/api.js';
import { customProviderColor } from '../services/formatters.js';
import type { ProviderDef } from '../services/providers.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { t } from '../i18n/index.js';
import { LetterBadge, ToggleSwitch, toggleRowClass } from './ProviderApiKeyTab.js';

const resolveCanonicalId = (name: string): string | null => {
  const shared =
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(normalizeProviderName(name)) ??
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(name) ??
    SHARED_PROVIDER_BY_ID_OR_ALIAS.get(name.toLowerCase());
  return shared && CANONICAL_LOCAL_IDS.has(shared.id) ? shared.id : null;
};

type ListItem =
  { kind: 'standard'; prov: ProviderDef } | { kind: 'custom'; cp: CustomProviderData };

interface Props {
  localProviders: ProviderDef[];
  customProviders: CustomProviderData[];
  /**
   * Reports whether the agent has an active tenant_providers row with
   * `auth_type: 'local'` for the given key. The key is `prov.id`
   * (`ollama`) for standard tiles and `custom:<uuid>` for custom-backed
   * tiles (LM Studio). A single check covers both because the tenant_providers
   * row is the source of truth for "is this provider actively routing?".
   */
  isConnected: (providerKey: string) => boolean;
  /**
   * Disable a connected local provider — flips the toggle OFF and
   * marks the tenant_providers row inactive so routing stops selecting it.
   * `providerKey` matches the argument to `isConnected()`.
   */
  onToggle: (providerKey: string) => void | Promise<void>;
  busy: boolean;
  onOpenDetail: (provId: string, authType: AuthType) => void;
  onEditCustom: (cp: CustomProviderData) => void;
  onOpenLocalServer: (prov: ProviderDef) => void;
}

export default function ProviderLocalTab(props: Props) {
  const customs = props.customProviders ?? [];
  const claimed = new Set<string>();
  for (const cp of customs) {
    const id = resolveCanonicalId(cp.name);
    if (id) claimed.add(id);
  }
  const standards: ListItem[] = props.localProviders
    .filter((prov) => !claimed.has(prov.id))
    .map((prov) => ({ kind: 'standard', prov }));
  // Only surface custom providers that resolve to a canonical local tile
  // (LM Studio, Ollama named). Freeform custom providers stay on the API
  // Keys tab since we don't know they point at localhost.
  const customItems: ListItem[] = customs
    .filter((cp) => resolveCanonicalId(cp.name) !== null)
    .map((cp) => ({ kind: 'custom', cp }));
  const merged = [...standards, ...customItems].sort((a, b) => {
    const nameA = a.kind === 'standard' ? a.prov.name : a.cp.name;
    const nameB = b.kind === 'standard' ? b.prov.name : b.cp.name;
    return nameA.localeCompare(nameB);
  });

  return (
    <>
      <p className="provider-modal__tab-hint mb-3 text-sm text-muted">
        {t('providerSetup.tabs.localHint')}
      </p>
      <div className="provider-modal__list flex flex-col gap-1.5">
        {merged.map((item) => {
          if (item.kind === 'custom') {
            const cp = item.cp;
            const providerKey = `custom:${cp.id}`;
            const connected = props.isConnected(providerKey);
            const handleToggle = (e: MouseEvent) => {
              e.stopPropagation();
              if (connected) {
                void props.onToggle(providerKey);
              } else {
                props.onEditCustom(cp);
              }
            };
            return (
              <button
                key={providerKey}
                type="button"
                className={toggleRowClass}
                disabled={props.busy}
                onClick={() => props.onEditCustom(cp)}
              >
                <span className="provider-toggle__icon inline-flex size-5 shrink-0 items-center justify-center">
                  {customProviderLogo(cp.name, 20, cp.base_url) ?? (
                    <LetterBadge color={customProviderColor(cp.name)}>
                      {cp.name.charAt(0).toUpperCase()}
                    </LetterBadge>
                  )}
                </span>
                <span className="provider-toggle__info min-w-0 flex-1">
                  <span className="provider-toggle__name block truncate text-sm font-medium text-ink">
                    {cp.name}
                  </span>
                </span>
                <ToggleSwitch on={connected} onClick={handleToggle} />
              </button>
            );
          }

          const prov = item.prov;
          const connected = props.isConnected(prov.id);
          const hasLocalPort = prov.defaultLocalPort !== undefined;

          const handleClick = () => {
            if (hasLocalPort) {
              props.onOpenLocalServer(prov);
              return;
            }
            props.onOpenDetail(prov.id, 'local');
          };
          const handleToggle = (e: MouseEvent) => {
            e.stopPropagation();
            if (connected) {
              void props.onToggle(prov.id);
            } else {
              handleClick();
            }
          };

          return (
            <button
              key={prov.id}
              type="button"
              className={toggleRowClass}
              disabled={props.busy}
              onClick={handleClick}
            >
              <span className="provider-toggle__icon inline-flex size-5 shrink-0 items-center justify-center">
                {providerIcon(prov.id, 20) ?? (
                  <LetterBadge color={prov.color}>{prov.initial}</LetterBadge>
                )}
              </span>
              <span className="provider-toggle__info min-w-0 flex-1">
                <span className="provider-toggle__name block truncate text-sm font-medium text-ink">
                  {prov.name}
                </span>
              </span>
              <ToggleSwitch on={connected} onClick={handleToggle} />
            </button>
          );
        })}
      </div>
    </>
  );
}
