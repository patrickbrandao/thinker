import { t } from '../i18n/index.js';

/**
 * First-run setup status check. Cached per page load so the login page,
 * setup page, and any guards can all ask without spamming the endpoint.
 */

interface SetupStatusResponse {
  needsSetup: boolean;
  socialProviders?: string[];
  localLlmHost?: string;
  emailConfigured?: boolean;
  mcpEnabled?: boolean;
  signupEnabled?: boolean;
}

interface SetupStatusResult {
  needsSetup: boolean;
  socialProviders: string[];
  localLlmHost: string;
  emailConfigured: boolean;
  mcpEnabled: boolean;
  signupEnabled: boolean;
}

let cachedPromise: Promise<SetupStatusResult> | null = null;

async function fetchSetupStatus(): Promise<SetupStatusResult> {
  try {
    const res = await fetch('/api/v1/setup/status', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok)
      return {
        needsSetup: false,
        socialProviders: [],
        localLlmHost: 'localhost',
        emailConfigured: true,
        mcpEnabled: true,
        signupEnabled: false,
      };
    const data = (await res.json()) as SetupStatusResponse;
    return {
      needsSetup: data.needsSetup === true,
      socialProviders: data.socialProviders ?? [],
      localLlmHost: data.localLlmHost || 'localhost',
      // Assume available unless the backend explicitly says otherwise, so a
      // transient status glitch never hides the email reset form.
      emailConfigured: data.emailConfigured !== false,
      // Same reasoning, plus a backend older than this field always serves MCP.
      mcpEnabled: data.mcpEnabled !== false,
      // Closed unless the backend explicitly opens it: a missing field or a
      // failed status call never advertises a sign-up page that would refuse.
      signupEnabled: data.signupEnabled === true,
    };
  } catch {
    return {
      needsSetup: false,
      socialProviders: [],
      localLlmHost: 'localhost',
      emailConfigured: true,
      mcpEnabled: true,
      signupEnabled: false,
    };
  }
}

function getSetupStatus(): Promise<SetupStatusResult> {
  if (!cachedPromise) {
    cachedPromise = fetchSetupStatus();
  }
  return cachedPromise;
}

export async function checkNeedsSetup(): Promise<boolean> {
  return (await getSetupStatus()).needsSetup;
}

export async function checkSocialProviders(): Promise<string[]> {
  return (await getSetupStatus()).socialProviders;
}

export async function checkLocalLlmHost(): Promise<string> {
  return (await getSetupStatus()).localLlmHost;
}

export async function checkEmailConfigured(): Promise<boolean> {
  return (await getSetupStatus()).emailConfigured;
}

/**
 * False when the backend runs without the remote MCP server — an install whose
 * origin cannot carry an HTTPS MCP resource, or one that set `MCP_ENABLED=false`.
 * The MCP setup page and its nav entry are hidden then, because the endpoint
 * they document does not exist.
 */
export async function checkMcpEnabled(): Promise<boolean> {
  return (await getSetupStatus()).mcpEnabled;
}

/**
 * True only when the backend allows public self-registration
 * (`THINKER_ALLOW_SIGNUP=true`). Sign-up links and the register page are
 * hidden otherwise.
 */
export async function checkSignupEnabled(): Promise<boolean> {
  return (await getSetupStatus()).signupEnabled;
}

/** Invalidate the cached status. Call this after a successful setup. */
export function resetSetupStatus(): void {
  cachedPromise = null;
}

export interface CreateAdminInput {
  email: string;
  name: string;
  password: string;
  setupToken: string;
}

/** Error from the setup endpoint, carrying the HTTP status. */
export class SetupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}

export async function createFirstAdmin(input: CreateAdminInput): Promise<void> {
  const res = await fetch('/api/v1/setup/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let message = t('ui.errors.setupFailed', { status: res.status });
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
    } catch {
      // not JSON — use default
    }
    throw new SetupError(message, res.status);
  }
  resetSetupStatus();
}
