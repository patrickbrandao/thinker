import { useLocation, useNavigate } from '@solidjs/router';
import { Show, createEffect, createSignal, type ParentComponent } from 'solid-js';
import { authClient } from '../services/auth-client.js';
import { buildLoginRedirect } from '../services/auth-redirects.js';
import { getDiscoveryPendingNext } from '../services/discovery.js';

const AuthGuard: ParentComponent = (props) => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [routeChecked, setRouteChecked] = createSignal(false);

  createEffect(() => {
    const s = session();
    if (s.isPending) return;
    if (!s.data) {
      navigate(buildLoginRedirect(location.pathname, location.search), { replace: true });
      return;
    }
    // The CLI consent page and the MCP OAuth consent page are not part of
    // onboarding. Gate them on an authenticated session only, so a user who is
    // mid-discovery can still authorize a client (otherwise the login flow
    // never gets its code).
    if (location.pathname === '/cli/auth' || location.pathname === '/consent') {
      setRouteChecked(true);
      return;
    }
    // A freshly signed-up user with the discovery step still pending is sent
    // back to it from anywhere in the app except the form itself.
    const pendingNext = getDiscoveryPendingNext(s.data.user?.id ?? '');
    if (pendingNext !== null && location.pathname !== '/discovery') {
      navigate(`/discovery?next=${encodeURIComponent(pendingNext)}`, { replace: true });
      return;
    }
    setRouteChecked(true);
  });

  return (
    <Show
      when={!session().isPending && session().data && routeChecked()}
      fallback={
        <div class="auth-layout">
          <div class="auth-card" style="text-align: center;">
            <div class="auth-logo">
              <img
                src="/logotype-white.svg"
                alt="Manifest LLM Gateway"
                class="auth-logo__img auth-logo__img--light"
              />
              <img src="/logotype-dark.svg" alt="" class="auth-logo__img auth-logo__img--dark" />
            </div>
            <p style="color: hsl(var(--muted-foreground)); font-size: var(--font-size-sm);">
              Loading...
            </p>
          </div>
        </div>
      }
    >
      {props.children}
    </Show>
  );
};

export default AuthGuard;
