import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { authClient } from '../services/auth-client.js';
import { buildLoginRedirect } from '../services/auth-redirects.js';
import { t } from '../i18n/index.js';
import AuthLayout from '../layouts/AuthLayout.jsx';

/** Renders children only with a session; otherwise sends the visitor to /login. */
export default function AuthGuard({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) {
      navigate(buildLoginRedirect(location.pathname, location.search), { replace: true });
    }
  }, [session.isPending, session.data, navigate, location.pathname, location.search]);

  if (session.isPending || !session.data) {
    return (
      <AuthLayout>
        <p className="text-center text-sm text-muted">{t('common.loading')}</p>
      </AuthLayout>
    );
  }
  return <>{children}</>;
}
