/**
 * Dashboard branding from the environment: the title and logo shown at the
 * top of the sidebar, and whether to hide the version and docs link.
 */
export interface Branding {
  title: string;
  logoUrl: string | null;
  hideInfo: boolean;
}

export function readBranding(env: NodeJS.ProcessEnv = process.env): Branding {
  const title = env['THINKER_TITLE']?.trim();
  const logoUrl = env['THINKER_LOGO_URL']?.trim();
  return {
    title: title || 'Thinker',
    logoUrl: logoUrl || null,
    hideInfo: env['THINKER_HIDE_INFO']?.trim().toLowerCase() === 'true',
  };
}

/** Origin of an absolute http(s) logo URL, for the CSP `img-src` list. */
export function logoOrigin(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    const url = new URL(logoUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null; // relative path, served by this instance
  }
}
