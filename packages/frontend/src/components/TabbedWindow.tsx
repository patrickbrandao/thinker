import { useState, type ReactNode } from 'react';
import { FloatingWindow, Tabs } from './ui.js';

/** One tab of a settings window. */
export interface WindowSection {
  key: string;
  label: string;
  content: ReactNode;
}

/**
 * The parts a settings form hands to its host, so the host can lay them out
 * as tabs in a window: the sections, a notice shown above every tab (errors),
 * the footer actions, and anything rendered outside the window (dialogs).
 */
export interface FormLayoutParts {
  sections: WindowSection[];
  notice?: ReactNode;
  actions: ReactNode;
  extra?: ReactNode;
}

export type FormLayout = (parts: FormLayoutParts) => ReactNode;

/**
 * A non-modal floating window whose body is split in tabs. The title bar,
 * the tab strip and the footer stay put; only the active tab scrolls.
 */
export default function TabbedWindow({
  open,
  title,
  icon,
  onClose,
  sections,
  notice,
  footer,
  tab,
  onTabChange,
  children,
}: {
  open: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  sections: WindowSection[];
  notice?: ReactNode;
  footer?: ReactNode;
  /** Controlled active tab; uncontrolled when omitted. */
  tab?: string;
  onTabChange?: (key: string) => void;
  /** Replaces the tabs (e.g. a confirmation step). */
  children?: ReactNode;
}) {
  const [own, setOwn] = useState<string | undefined>(undefined);
  const wanted = tab ?? own;
  const active = sections.find((s) => s.key === wanted) ?? sections[0];
  const select = (key: string) => {
    setOwn(key);
    onTabChange?.(key);
  };
  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title={title}
      icon={icon}
      className="floating-window--wide tabbed-window"
      footer={footer}
    >
      {children ?? (
        <>
          {sections.length > 1 ? (
            <Tabs
              className="tabbed-window-tabs"
              label={title}
              value={active?.key ?? ''}
              onChange={select}
              items={sections.map((s) => ({ key: s.key, label: s.label }))}
            />
          ) : null}
          {notice}
          {active?.content}
        </>
      )}
    </FloatingWindow>
  );
}
