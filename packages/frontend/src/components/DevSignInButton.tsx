/* v8 ignore start -- dev-only shortcut, validated in the local dev server. */
import type { Component } from 'solid-js';

// Dev-only seed credentials (see packages/backend/src/database/database-seeder.service.ts,
// seeded only when SEED_DATA=true / non-production). Login.tsx loads this module through
// a dynamic import inside its `import.meta.env.DEV` branch, so production builds drop the
// module, these literals and the button template (#229). The account exists only in a
// dev database.
const DEV_EMAIL = 'admin@thinker.example.com';
const DEV_PASSWORD = 'thinker';

const DevSignInButton: Component<{
  disabled: boolean;
  onSignIn: (email: string, password: string) => void;
}> = (props) => (
  <button
    type="button"
    class="auth-form__submit"
    onClick={() => props.onSignIn(DEV_EMAIL, DEV_PASSWORD)}
    disabled={props.disabled}
    style="background:#f59e0b;color:#1f1400;font-weight:700;margin-bottom:0.75rem;"
  >
    ⚡ Sign in as dev, {DEV_EMAIL}
  </button>
);

export default DevSignInButton;
/* v8 ignore stop */
