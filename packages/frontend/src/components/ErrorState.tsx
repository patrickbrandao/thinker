import { t } from '../i18n/index.js';
import { Button } from './ui.js';

interface ErrorStateProps {
  /** The error from useResource (used to extract a message). */
  error?: unknown;
  /** Override the default title ("Something went wrong"). */
  title?: string;
  /** Override the subtitle derived from the error message. */
  message?: string;
  /** Called when the user clicks "Try again". Omit to hide the retry button. */
  onRetry?: () => void;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return t('ui.unexpectedError');
}

export default function ErrorState({ error, title, message, onRetry }: ErrorStateProps) {
  return (
    <div className="empty" role="alert">
      <h3>{title ?? t('common.somethingWentWrong')}</h3>
      <p className="max-w-md text-sm">{message ?? extractMessage(error)}</p>
      {onRetry ? (
        <Button variant="ghost" size="sm" className="mt-3" onClick={onRetry}>
          {t('common.tryAgain')}
        </Button>
      ) : null}
    </div>
  );
}
