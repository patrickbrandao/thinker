import type { ReactNode } from 'react';
import { t } from '../i18n/index.js';

/** Title and subtitle at the top of an `.auth-card` screen. */
export function AuthHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="auth-header mb-5 text-center">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
    </div>
  );
}

/** "or" rule between the social buttons and the email form. */
export function AuthDivider() {
  return (
    <div className="auth-divider my-4 flex items-center gap-3 text-xs text-faint">
      <span className="h-px flex-1 bg-line" />
      <span>{t('auth.or')}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Centered line under the form ("Don't have an account? Sign up"). */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <p className="mt-5 text-center text-sm text-muted">{children}</p>;
}

/** Text-style button inside auth forms (resend email, sign out). */
export const authLinkButtonClass =
  'self-start border-0 bg-transparent p-0 text-sm text-accent hover:underline disabled:cursor-not-allowed disabled:text-faint disabled:no-underline';
