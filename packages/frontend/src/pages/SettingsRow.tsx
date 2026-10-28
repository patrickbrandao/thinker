import type { ReactNode } from 'react';
import { cx } from '../components/ui.js';

/**
 * One setting: title and description on the left, the control on the right.
 * Stacks on phone width. Used by the harness Settings tab and its sections.
 */
export default function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-ink">{title}</div>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}
