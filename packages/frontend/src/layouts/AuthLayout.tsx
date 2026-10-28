import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { THINKER_LOGO_URL, THINKER_LOGO_DARK_URL } from '../services/thinker-links.js';

/** Centered card on the dotted background, for sign-in and setup screens. */
export default function AuthLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <img src={THINKER_LOGO_URL} alt="Thinker" className="logo-light" />
          <img src={THINKER_LOGO_DARK_URL} alt="" className="logo-dark" />
        </div>
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
