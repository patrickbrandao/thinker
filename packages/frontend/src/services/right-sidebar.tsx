import { createContext, useContext, useState, type ReactNode } from 'react';

interface RightSidebarState {
  content: ReactNode | null;
  setContent: (content: ReactNode | null) => void;
}

const RightSidebarContext = createContext<RightSidebarState | null>(null);

/** Holds the optional panel a page docks on the right of the dashboard shell. */
export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  return (
    <RightSidebarContext.Provider value={{ content, setContent }}>
      {children}
    </RightSidebarContext.Provider>
  );
}

export function useRightSidebar(): RightSidebarState {
  const ctx = useContext(RightSidebarContext);
  if (!ctx) throw new Error('useRightSidebar must be used inside RightSidebarProvider');
  return ctx;
}
