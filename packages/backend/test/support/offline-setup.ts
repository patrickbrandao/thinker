/**
 * Jest `setupFilesAfterEnv` for the e2e suite (issue #114): no e2e test may
 * reach the internet. Installs the offline guard before each spec file and
 * fails the test (or, for calls made outside a test, the file) that tried to
 * open a connection or resolve a name outside loopback and the disposable
 * Postgres. See offline-guard.ts.
 */
import { formatViolations, installOfflineGuard } from './offline-guard';

const guard = installOfflineGuard();

function assertNoEgress(): void {
  const violations = guard.drain();
  if (violations.length > 0) throw new Error(formatViolations(violations));
}

afterEach(assertNoEgress);
afterAll(assertNoEgress);
