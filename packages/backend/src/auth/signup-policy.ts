import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who may create a Better Auth user (#29).
 *
 * Public sign-up is closed: the first account is created only by the setup
 * wizard, and later accounts only when the provisional
 * `THINKER_ALLOW_SIGNUP=true` valve is set (removed in v0.3, when the admin
 * creates accounts). The rule is enforced in Better Auth's
 * `databaseHooks.user.create.before`, so it covers email/password and social
 * sign-in alike.
 *
 * Server-side code that must create a user (the setup wizard under its
 * advisory lock, the dev-only seeder) marks the call with
 * `runAsServerUserCreation`. The mark lives in an AsyncLocalStorage that only
 * in-process code can enter: no HTTP request, header or body can set it.
 */

const serverUserCreation = new AsyncLocalStorage<true>();

export const SIGNUP_VALVE_ENV = 'THINKER_ALLOW_SIGNUP';

/** Runs `fn` as trusted server-side user creation. */
export function runAsServerUserCreation<T>(fn: () => Promise<T>): Promise<T> {
  return serverUserCreation.run(true, fn);
}

/** True only inside `runAsServerUserCreation`. */
export function isServerUserCreation(): boolean {
  return serverUserCreation.getStore() === true;
}

/** The provisional valve that reopens sign-up once the first admin exists. */
export function isSignupValveOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SIGNUP_VALVE_ENV] === 'true';
}

export const SIGNUP_CLOSED_MESSAGE =
  'Sign-up is closed on this instance. Ask the administrator for an account.';
export const FIRST_USER_VIA_SETUP_MESSAGE =
  'The first account is created by the setup wizard (/setup).';

export type UserCreationDecision = { allowed: true } | { allowed: false; message: string };

/**
 * Decides whether a user may be created right now. `hasUsers` is only
 * consulted when the valve is open, so the closed default costs no query.
 */
export async function decideUserCreation(
  hasUsers: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UserCreationDecision> {
  if (isServerUserCreation()) return { allowed: true };
  if (!isSignupValveOpen(env)) return { allowed: false, message: SIGNUP_CLOSED_MESSAGE };
  if (!(await hasUsers())) return { allowed: false, message: FIRST_USER_VIA_SETUP_MESSAGE };
  return { allowed: true };
}
