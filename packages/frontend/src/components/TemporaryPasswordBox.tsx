import { KeyRound } from 'lucide-react';
import CopyButton from './CopyButton.js';
import { Button } from './ui.js';
import { t } from '../i18n/index.js';

interface TemporaryPasswordBoxProps {
  /** Who the password belongs to, shown in the title. */
  email: string;
  password: string;
  onDismiss: () => void;
}

/**
 * Shows a server-generated temporary password exactly once. The caller drops
 * it from state on dismiss; nothing is persisted.
 */
export default function TemporaryPasswordBox({
  email,
  password,
  onDismiss,
}: TemporaryPasswordBoxProps) {
  return (
    <div className="well flex flex-col gap-2" role="status">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <KeyRound className="size-[15px] text-accent" aria-hidden="true" />
        {t('org.tempPassword.title', { email })}
      </span>
      <span className="text-xs text-warn">{t('org.tempPassword.warning')}</span>
      <div className="flex items-center gap-2 rounded-control border border-line bg-elev px-2.5 py-1.5">
        <code
          className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink"
          data-testid="temporary-password"
        >
          {password}
        </code>
        <CopyButton text={password} />
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('org.tempPassword.saved')}
        </Button>
      </div>
    </div>
  );
}
