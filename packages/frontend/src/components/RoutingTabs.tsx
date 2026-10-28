import { useState, type ReactNode } from 'react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

export type RoutingTabId = 'default' | 'specificity' | 'custom';

interface Tab {
  id: RoutingTabId;
  label: string;
  dot: boolean;
}

export interface RoutingTabsProps {
  specificityEnabled: boolean;
  customEnabled: boolean;
  /**
   * Gate for the deprecated Task-specific tab. When this returns false the tab
   * is not rendered at all — used to hide task-specific routing from agents that
   * never configured it (see `legacySpecificityVisible` in Routing.tsx).
   * Defaults to shown so existing callers/tests are unaffected.
   */
  showSpecificity?: boolean;
  pipelineHelp?: ReactNode | null;
  /** Slot rendered to the right of the tabs (e.g. response mode toggle). */
  headerRight?: ReactNode;
  /** When set, the help button is removed from the header. The parent manages the modal. */
  onShowHelp?: () => void;
  children: {
    default: ReactNode;
    specificity: ReactNode;
    custom: ReactNode;
  };
}

/**
 * Routing layer tabs (Default / Task-specific / Custom). The `panel__tab*` and
 * `routing-tabs__*` classes are stable test hooks; the look comes from `.tabs`.
 */
export default function RoutingTabs(props: RoutingTabsProps) {
  const [activeTab, setActiveTab] = useState<RoutingTabId>('default');

  const showSpecificity = props.showSpecificity ?? true;

  const tabs: Tab[] = [
    { id: 'default', label: t('routing.tabs.default'), dot: true },
    ...(showSpecificity
      ? [
          {
            id: 'specificity' as RoutingTabId,
            label: t('routing.tabs.specificity'),
            dot: props.specificityEnabled,
          },
        ]
      : []),
    { id: 'custom', label: t('routing.tabs.custom'), dot: props.customEnabled },
  ];

  return (
    <div className="routing-tabs">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <div className="tabs mb-0 border-b-0" role="tablist" aria-label={t('routing.tabs.label')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cx(
                'panel__tab tab',
                activeTab === tab.id && 'panel__tab--active is-active',
              )}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`routing-tabpanel-${tab.id}`}
              id={`routing-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'routing-tabs__dot size-1.5 rounded-full',
                  tab.dot ? 'routing-tabs__dot--on bg-ok' : 'routing-tabs__dot--off bg-s4',
                )}
              />
              {tab.label}
            </button>
          ))}
        </div>
        {props.headerRight ? (
          <div className="routing-tabs__header-right pb-2">{props.headerRight}</div>
        ) : null}
      </div>
      <div
        className="routing-tabs__panel"
        role="tabpanel"
        id={`routing-tabpanel-${activeTab}`}
        aria-labelledby={`routing-tab-${activeTab}`}
      >
        {activeTab === 'default' ? props.children.default : null}
        {activeTab === 'specificity' && showSpecificity ? props.children.specificity : null}
        {activeTab === 'custom' ? props.children.custom : null}
      </div>
    </div>
  );
}
