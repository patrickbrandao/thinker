import type { KeyboardEvent, MouseEvent } from 'react';
import { ListPlus, Shapes } from 'lucide-react';
import {
  CANONICAL_LOCAL_IDS,
  SHARED_PROVIDER_BY_ID_OR_ALIAS,
  normalizeProviderName,
} from 'thinker-shared';
import type { AuthType, CustomProviderData } from '../services/api.js';
import { customProviderColor } from '../services/formatters.js';
import type { ProviderDef } from '../services/providers.js';
import type { CustomProviderPrefill } from '../services/routing-params.js';
import { providerIcon, customProviderLogo } from './ProviderIcon.js';
import { t } from '../i18n/index.js';
import { Badge, cx } from './ui.js';

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
  apiKeyProviders: ProviderDef[];
  customProviders: CustomProviderData[];
  isConnected: (provId: string) => boolean;
  isNoKeyConnected: (provId: string) => boolean;
  onOpenDetail: (provId: string, authType: AuthType) => void;
  onAddKey: (provId: string, authType: AuthType) => void;
  onOpenCustomForm: (prefill?: CustomProviderPrefill) => void;
  onEditCustom: (cp: CustomProviderData) => void;
}

/** Row look shared by the provider tabs; `provider-toggle*` are stable test hooks. */
export const toggleRowClass =
  'provider-toggle flex w-full cursor-pointer items-center gap-3 rounded-control border border-line bg-elev px-3 py-2.5 text-left hover:bg-s2 disabled:cursor-not-allowed disabled:opacity-50';

/** Brand-colored initial shown when a provider has no logo. */
export function LetterBadge({ color, children }: { color: string; children: string }) {
  return (
    <span
      className="provider-card__logo-letter inline-flex size-5 items-center justify-center rounded-control text-[10px] font-semibold text-white"
      // The provider's brand color is data, not a theme token.
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

/** Visual-only switch (the row itself is the control). */
export function ToggleSwitch({
  on,
  onClick,
}: {
  on: boolean;
  onClick?: (event: MouseEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      aria-hidden="true"
      aria-checked={on}
      className={cx('switch provider-toggle__switch shrink-0', on && 'provider-toggle__switch--on')}
      onClick={onClick}
    />
  );
}

/**
 * "Add another key" action inside a row button. A real <button> cannot nest
 * in a <button>, so it is a focusable span with button semantics.
 */
export function RowAddAction({
  label,
  tooltip,
  onActivate,
}: {
  label: string;
  tooltip: string;
  onActivate: () => void;
}) {
  const activate = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    onActivate();
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className="provider-toggle__add-btn icon-btn"
      aria-label={label}
      title={tooltip}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      }}
    >
      <ListPlus aria-hidden="true" />
    </span>
  );
}

export default function ProviderApiKeyTab(props: Props) {
  const customs = props.customProviders ?? [];
  // Custom rows that resolve to a canonical local-LLM id belong in the
  // Local tab now. Hide them here so there's no duplicate entry across
  // tabs, and so the API Keys tab is strictly about BYOK providers.
  const customItems: ListItem[] = customs
    .filter((cp) => resolveCanonicalId(cp.name) === null)
    .map((cp) => ({ kind: 'custom', cp }));
  const standards: ListItem[] = props.apiKeyProviders.map((prov) => ({ kind: 'standard', prov }));
  const merged = [...standards, ...customItems].sort((a, b) => {
    const nameA = a.kind === 'standard' ? a.prov.name : a.cp.name;
    const nameB = b.kind === 'standard' ? b.prov.name : b.cp.name;
    return nameA.localeCompare(nameB);
  });

  return (
    <>
      <p className="provider-modal__tab-hint mb-3 text-sm text-muted">
        {t('providerSetup.tabs.apiKeyHint')}
      </p>
      <div className="provider-modal__list flex flex-col gap-1.5">
        {merged.map((item) => {
          if (item.kind === 'custom') {
            const cp = item.cp;
            return (
              <button
                key={`custom:${cp.id}`}
                type="button"
                className={toggleRowClass}
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
                  <span className="provider-toggle__name flex items-center gap-2 truncate text-sm font-medium text-ink">
                    {cp.name}
                    <Badge className="provider-toggle__tag">{t('providerSetup.tabs.custom')}</Badge>
                  </span>
                </span>
                <ToggleSwitch on />
              </button>
            );
          }

          const prov = item.prov;
          const connected = props.isConnected(prov.id) || props.isNoKeyConnected(prov.id);

          // localOnly tiles live under the Local tab now — the parent
          // (ProviderSelectContent) filters them out of `apiKeyProviders`,
          // so every standard tile here is an API-key provider.
          return (
            <button
              key={prov.id}
              type="button"
              className={toggleRowClass}
              onClick={() => props.onOpenDetail(prov.id, 'api_key')}
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
              <span className="provider-toggle__actions flex shrink-0 items-center gap-2">
                {connected ? (
                  <RowAddAction
                    label={t('providerSetup.tabs.addAnotherKeyFor', { name: prov.name })}
                    tooltip={t('providerSetup.shared.addAnotherKey')}
                    onActivate={() => props.onAddKey(prov.id, 'api_key')}
                  />
                ) : null}
                <ToggleSwitch on={connected} />
              </span>
            </button>
          );
        })}
        <div className="provider-modal__add-custom pt-2">
          <button
            type="button"
            className="provider-modal__add-custom-chip btn btn-ghost btn-sm"
            onClick={() => props.onOpenCustomForm()}
          >
            <Shapes aria-hidden="true" />
            {t('providerSetup.tabs.addCustomProvider')}
          </button>
        </div>
      </div>
    </>
  );
}
