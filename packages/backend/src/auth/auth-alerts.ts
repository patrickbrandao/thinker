import { emitUserAlert } from '../common/services/alert-sink';
import { CLIENT_IP_HEADER } from '../common/utils/client-ip';

/** Failed logins for one e-mail and address collapse into one alert per window. */
export const LOGIN_FAILED_WINDOW_MS = 5 * 60_000;

/** What the after-hook needs from Better Auth's endpoint context. */
export interface AuthHookContext {
  path: string;
  body?: unknown;
  headers?: Headers | null;
  request?: Request | null;
  context: {
    returned?: unknown;
    newSession?: { user?: { id?: string; email?: string | null } | null } | null;
    session?: { user?: { id?: string; email?: string | null } | null } | null;
  };
}

function header(ctx: AuthHookContext, name: string): string | null {
  return ctx.headers?.get(name) ?? ctx.request?.headers.get(name) ?? null;
}

/** An APIError (or any error-like value) returned by the endpoint. */
function failed(returned: unknown): boolean {
  if (!returned || typeof returned !== 'object') return false;
  const r = returned as { status?: unknown; statusCode?: unknown; name?: unknown };
  return (
    r.name === 'APIError' ||
    (typeof r.statusCode === 'number' && r.statusCode >= 400) ||
    (typeof r.status === 'string' && typeof r.statusCode === 'number')
  );
}

function bodyEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === 'string' && email.length <= 320 ? email.trim().toLowerCase() : null;
}

/**
 * Better Auth after-hook: user.login, user.login_failed, user.logout and
 * user.password_changed alerts. Never throws.
 */
export function recordAuthAlert(ctx: AuthHookContext, signedOutUser?: AuthUserRef | null): void {
  try {
    const ip = header(ctx, CLIENT_IP_HEADER);
    const ua = header(ctx, 'user-agent');
    const actor = { actorIp: ip, actorUserAgent: ua };
    const returned = ctx.context.returned;
    if (ctx.path === '/sign-in/email' || ctx.path.startsWith('/sign-in/')) {
      const email = bodyEmail(ctx.body);
      if (failed(returned)) {
        if (!email && ctx.path !== '/sign-in/email') return;
        emitUserAlert(
          { email },
          {
            ...actor,
            level: 'warning',
            type: 'user.login_failed',
            title: `Failed login for ${email ?? 'unknown account'}`,
            message: `Sign-in rejected${ip ? ` from ${ip}` : ''}.`,
            entityType: 'user',
            entityName: email,
            metadata: { email, method: ctx.path.slice('/sign-in/'.length) },
            dedupeKey: `user.login_failed:${email ?? ''}:${ip ?? ''}`,
            dedupeWindowMs: LOGIN_FAILED_WINDOW_MS,
            aggregate: true,
          },
        );
        return;
      }
      const user = ctx.context.newSession?.user;
      if (!user?.id) return;
      emitUserAlert(
        { userId: user.id },
        {
          ...actor,
          level: 'info',
          type: 'user.login',
          title: `${user.email ?? 'User'} signed in`,
          message: ip ? `From ${ip}.` : '',
          entityType: 'user',
          entityId: user.id,
          entityName: user.email ?? null,
          actorUserId: user.id,
          metadata: { method: ctx.path.slice('/sign-in/'.length) },
        },
      );
      return;
    }
    if (ctx.path === '/sign-out') {
      if (!signedOutUser?.id) return;
      emitUserAlert(
        { userId: signedOutUser.id },
        {
          ...actor,
          level: 'info',
          type: 'user.logout',
          title: `${signedOutUser.email ?? 'User'} signed out`,
          entityType: 'user',
          entityId: signedOutUser.id,
          entityName: signedOutUser.email ?? null,
          actorUserId: signedOutUser.id,
        },
      );
      return;
    }
    if (ctx.path === '/change-password' || ctx.path === '/reset-password') {
      if (failed(returned)) return;
      const user = ctx.context.session?.user ?? ctx.context.newSession?.user ?? null;
      if (!user?.id) return;
      emitUserAlert(
        { userId: user.id },
        {
          ...actor,
          level: 'info',
          type: 'user.password_changed',
          title: `${user.email ?? 'A user'} changed the password`,
          message: ctx.path === '/reset-password' ? 'Through a password reset link.' : '',
          entityType: 'user',
          entityId: user.id,
          entityName: user.email ?? null,
          actorUserId: user.id,
          metadata: { via: ctx.path.slice(1) },
        },
      );
    }
  } catch {
    // Alerts never break authentication.
  }
}

export interface AuthUserRef {
  id: string;
  email?: string | null;
}
