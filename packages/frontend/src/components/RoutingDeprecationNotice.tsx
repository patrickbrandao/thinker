import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

export interface RoutingDeprecationNoticeProps {
  /** Short bold lead-in, e.g. "Complexity routing is being retired." */
  title: string;
  /** Explanatory body (plain text or inline markup). */
  children: ReactNode;
}

/**
 * Inline, non-blocking deprecation banner rendered on the routing surfaces
 * that are being retired. It only mounts inside sections shown to legacy /
 * invested agents, so new ("clean") agents never see it.
 */
export default function RoutingDeprecationNotice(props: RoutingDeprecationNoticeProps) {
  return (
    <div className="routing-deprecation notice is-warn flex items-start gap-2" role="note">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="text-sm">
        <span className="font-semibold">{props.title}</span> <span>{props.children}</span>
      </div>
    </div>
  );
}
