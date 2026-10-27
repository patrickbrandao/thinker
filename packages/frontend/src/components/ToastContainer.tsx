import { useEffect } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { toasts, dismissToast, type Toast } from '../services/toast-store.js';
import { useSignal } from '../lib/signal.js';
import { t } from '../i18n/index.js';

const ICONS = { error: CircleAlert, success: CircleCheck, warning: TriangleAlert };

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);
  const Icon = ICONS[toast.type];
  return (
    <div className={`toast is-${toast.type}`} role="alert" aria-live="assertive">
      <Icon aria-hidden="true" />
      <span className="toast-msg">{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => dismissToast(toast.id)}
        aria-label={t('ui.dismissNotification')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const items = useSignal(toasts);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions removals">
      {items.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}
