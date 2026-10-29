import { useParams } from 'react-router';
import RequestDrawer from '../components/RequestDrawer.js';
import { t } from '../i18n/index.js';

/** One request's details on a page of its own (opened from the drawer in a new tab). */
export default function RequestPage() {
  const { requestId } = useParams();
  if (requestId) document.title = t('messages.drawer.title', { id: requestId.slice(0, 12) });
  return (
    <main className="request-page bg-surface">
      <RequestDrawer messageId={requestId ?? null} onClose={() => window.close()} variant="page" />
    </main>
  );
}
