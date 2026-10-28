import {
  Bot,
  CreditCard,
  FlaskConical,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { t, type TranslationKey } from '../i18n/index.js';

/**
 * The main menu. The sidebar, the topbar trail and the ⌘K "Go to" commands
 * all read this list, so a new page is added here once. Account, organization,
 * administration and integrations live in the user menu (UserMenu.tsx).
 */
export interface NavItem {
  key: string;
  to: string;
  label: TranslationKey;
  icon: LucideIcon;
  /** Extra path prefixes that also mark the item active. */
  match?: string[];
}

export interface NavGroup {
  key: string;
  /** Group heading; the first group has none. */
  label?: TranslationKey;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    key: 'main',
    items: [
      { key: 'overview', to: '/overview', label: 'nav.overview', icon: LayoutDashboard },
      { key: 'requests', to: '/messages', label: 'nav.requests', icon: ScrollText },
      { key: 'harnesses', to: '/harnesses', label: 'nav.harnesses', icon: Bot },
      { key: 'topology', to: '/topology', label: 'nav.topology', icon: Workflow },
    ],
  },
  {
    key: 'providers',
    label: 'nav.sectionProviders',
    items: [
      { key: 'local', to: '/providers/local', label: 'nav.local', icon: HardDrive },
      { key: 'usage', to: '/providers/usage-based', label: 'nav.usageBased', icon: KeyRound },
      {
        key: 'subscriptions',
        to: '/providers/subscriptions',
        label: 'nav.subscriptions',
        icon: CreditCard,
        match: ['/providers/connections'],
      },
    ],
  },
  {
    key: 'tools',
    label: 'nav.sectionTools',
    items: [{ key: 'playground', to: '/playground', label: 'nav.playground', icon: FlaskConical }],
  },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  return [item.to, ...(item.match ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The menu item the current path belongs to, for the topbar trail. */
export function activeNavItem(pathname: string): NavItem | undefined {
  for (const group of NAVIGATION) {
    const hit = group.items.find((item) => isNavActive(item, pathname));
    if (hit) return hit;
  }
  return undefined;
}

export const navLabel = (item: NavItem): string => t(item.label);
