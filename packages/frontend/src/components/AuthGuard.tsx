import { useLocation, useNavigate } from '@solidjs/router';
import { Show, createEffect, type ParentComponent } from 'solid-js';
import { authClient } from '../services/auth-client.js';
import { buildLoginRedirect } from '../services/auth-redirects.js';
import { THINKER_LOGO_URL, THINKER_LOGO_DARK_URL } from '../services/thinker-links.js';

const AuthGuard: ParentComponent = (props) => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();

  createEffect(() => {
    const s = session();
    if (s.isPending) return;
    if (!s.data) {
      navigate(buildLoginRedirect(location.pathname, location.search), { replace: true });
    }
  });

  return (
    <Show
      when={!session().isPending && session().data}
      fallback={
        <div class="auth-layout">
          <div class="auth-card" style="text-align: center;">
            <div class="auth-logo">
              <img
                src={THINKER_LOGO_URL}
                alt="Thinker"
                class="auth-logo__img auth-logo__img--light"
              />
              <img src={THINKER_LOGO_DARK_URL} alt="" class="auth-logo__img auth-logo__img--dark" />
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
