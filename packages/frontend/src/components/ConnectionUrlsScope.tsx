import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { roleCan } from '../services/session-store.js';
import { getProviderUrlSlots, type UrlOverrides } from '../services/api/provider-urls.js';
import ConnectionUrlsTab, {
  type UrlDraft,
  urlDraftErrors,
  urlOverridesToCreate,
} from './ConnectionUrlsTab.js';
import { SectionTabs } from './TabbedWindow.js';

interface UrlsScope {
  /**
   * The overrides to send with the request that creates the account: only
   * the slots the user filled in (undefined when none). Null when one is
   * invalid; the URLs tab is then shown with the error.
   */
  collect: () => UrlOverrides | undefined | null;
  /** The region the flow picked, for the defaults shown as placeholders. */
  setRegion: (region: string | undefined) => void;
}

const UrlsScopeContext = createContext<UrlsScope | null>(null);

/** The URL overrides of the add flow around this component; null outside one. */
export function useUrlsScope(): UrlsScope | null {
  return useContext(UrlsScopeContext);
}

/** {@link UrlsScope.collect} of a scope, or undefined without one. */
export function collectUrlOverrides(scope: UrlsScope | null): UrlOverrides | undefined | null {
  return scope ? scope.collect() : undefined;
}

/**
 * Wraps an "add account" flow in two tabs: the flow itself first, then
 * "URLs" with the provider's URL slots. The URLs tab is optional: a user who
 * never opens it sends no overrides.
 */
export function AddConnectionUrlsTabs({
  provider,
  authType,
  children,
}: {
  provider: string;
  authType: string;
  children: ReactNode;
}) {
  const [tab, setTab] = useState('connection');
  const [region, setRegion] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<UrlDraft>({});
  const slots = useResource(
    () => getProviderUrlSlots(provider, authType, region),
    [provider, authType, region],
  );
  const list = slots.data?.slots ?? [];
  const locked = !roleCan.editAccountUrls(authType);
  const latest = useRef({ list, draft, locked });
  latest.current = { list, draft, locked };

  const scope = useMemo<UrlsScope>(
    () => ({
      collect: () => {
        const { list: current, draft: typed, locked: readOnly } = latest.current;
        if (readOnly) return undefined;
        if (Object.keys(urlDraftErrors(current, typed)).length) {
          setTab('urls');
          return null;
        }
        const overrides = urlOverridesToCreate(current, typed);
        return Object.keys(overrides).length ? overrides : undefined;
      },
      setRegion: (next) => setRegion(next || undefined),
    }),
    [],
  );

  return (
    <UrlsScopeContext.Provider value={scope}>
      <SectionTabs
        label={t('providerSetup.urls.tabsLabel')}
        tab={tab}
        onTabChange={setTab}
        sections={[
          { key: 'connection', label: t('providerSetup.urls.tabConnection'), content: children },
          {
            key: 'urls',
            label: t('providerSetup.urls.tab'),
            content: (
              <ConnectionUrlsTab
                slots={list}
                value={draft}
                onChange={setDraft}
                locked={locked}
                loading={slots.loading}
                idPrefix={`add-url-${provider}`}
              />
            ),
          },
        ]}
      />
    </UrlsScopeContext.Provider>
  );
}
