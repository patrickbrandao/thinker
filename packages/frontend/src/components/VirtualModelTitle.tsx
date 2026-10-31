import { FileCode2 } from 'lucide-react';
import { t } from '../i18n/index.js';

interface Props {
  name: string;
  onShowExample: () => void;
}

/**
 * Card title of a virtual model, `auto` included: the script icon that opens
 * the usage example, then the name as a code badge.
 */
export default function VirtualModelTitle(props: Props) {
  return (
    <span className="virtual-model-title flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        className="virtual-model-title__example icon-btn size-6 shrink-0 text-muted hover:text-accent"
        aria-label={t('models.vmCard.showExampleFor', { name: props.name })}
        title={t('models.vmCard.showExample')}
        onClick={() => props.onShowExample()}
      >
        <FileCode2 aria-hidden="true" className="size-3.5" />
      </button>
      <code className="routing-card__auto header-tier-card__name truncate rounded-control border border-accent bg-accent-tint px-1.5 py-px font-mono font-bold text-accent">
        {props.name}
      </code>
    </span>
  );
}
