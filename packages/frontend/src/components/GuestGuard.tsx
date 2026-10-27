import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../services/auth-client.js';
import { getAuthDestination, signedOAuthDestination } from '../services/auth-redirects.js';
import { checkNeedsSetup } from '../services/setup-status.js';

/** Sign-in screens: send signed-in visitors on, and a fresh install to /setup. */
export default function GuestGuard({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [setupChecked, setSetupChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkNeedsSetup().then((needsSetup) => {
      if (cancelled) return;
      if (needsSetup) navigate('/setup', { replace: true });
      else setSetupChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (session.isPending || !session.data) return;
    const destination = getAuthDestination(Object.fromEntries(searchParams), location.search);
    if (signedOAuthDestination(location.search) === destination) {
      globalThis.location.assign(destination);
      return;
    }
    navigate(destination, { replace: true });
  }, [session.isPending, session.data, searchParams, location.search, navigate]);

  // Once shown, keep the form mounted: Better Auth refetches the session (e.g.
  // on window focus) and a brief isPending must not wipe what the user typed.
  const [ready, setReady] = useState(false);
  const canShow = setupChecked && !session.isPending && !session.data;
  if (canShow && !ready) setReady(true);

  if (!ready && !canShow) return null;
  return <>{children}</>;
}
