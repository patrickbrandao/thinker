import type { ReactNode } from 'react';

interface ReadOnlyRegionProps {
  readOnly: boolean;
  /** Notice shown above the region when read-only. Omit to show none. */
  notice?: string;
  children?: ReactNode;
}

/**
 * Wraps a page region in a disabled <fieldset> when the current role can't
 * change it: every button, input and select inside is disabled while links and
 * the data stay visible. The backend enforces the same rule.
 */
export default function ReadOnlyRegion({ readOnly, notice, children }: ReadOnlyRegionProps) {
  return (
    <>
      {readOnly && notice ? (
        <div className="readonly-notice notice is-info mb-3" role="note">
          {notice}
        </div>
      ) : null}
      <fieldset className="readonly-region m-0 min-w-0 border-0 p-0" disabled={readOnly}>
        {children}
      </fieldset>
    </>
  );
}
