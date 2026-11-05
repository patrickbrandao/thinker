import { signal } from '../lib/signal.js';

/**
 * Name of the entity a detail page shows (a proxy server, the trigger test
 * page), so the top bar renders `Section › name` instead of the page repeating
 * the title below it. `path` scopes the crumb to the page that set it.
 */
interface PageBreadcrumb {
  name: string | null;
  path: string | null;
}

export const pageBreadcrumbSignal = signal<PageBreadcrumb>({ name: null, path: null });

export function setPageBreadcrumb(name: string | null, path: string | null = null): void {
  pageBreadcrumbSignal.set({ name, path: name ? path : null });
}
