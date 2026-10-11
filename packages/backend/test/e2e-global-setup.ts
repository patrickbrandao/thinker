import { resolveE2eDatabaseUrl } from './e2e-db-guard';

/**
 * Jest globalSetup for the e2e suite: runs once, before any spec file is
 * loaded, so an unsafe DATABASE_URL aborts the run before any connection is
 * opened. Every spec also resolves its URL through the same guard.
 */
export default function e2eGlobalSetup(): void {
  const url = resolveE2eDatabaseUrl();
  const { hostname, port, pathname } = new URL(url);
  // Never print credentials.
  process.stdout.write(
    `\n[e2e] Using test database ${pathname.slice(1)} on ${hostname}:${port || '5432'}\n`,
  );
}
