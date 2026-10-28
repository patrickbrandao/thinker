/* v8 ignore start -- dev-only shortcut, validated in the local dev server. */
import { t } from '../i18n/index.js';

// Dev-only seed credentials (see packages/backend/src/database/database-seeder.service.ts,
// seeded only when SEED_DATA=true / non-production). Login.tsx loads this module through
// a dynamic import inside its `import.meta.env.DEV` branch, so production builds drop the
// module, these literals and the button template (#229). The account exists only in a
// dev database.
const DEV_EMAIL = 'admin@thinker.example.com';
const DEV_PASSWORD = 'thinker';

export default function DevSignInButton({
  disabled,
  onSignIn,
}: {
  disabled: boolean;
  onSignIn: (email: string, password: string) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-block border-warn bg-warn-tint font-bold text-warn"
      onClick={() => onSignIn(DEV_EMAIL, DEV_PASSWORD)}
      disabled={disabled}
    >
      {t('auth.devSignIn', { email: DEV_EMAIL })}
    </button>
  );
}
/* v8 ignore stop */
