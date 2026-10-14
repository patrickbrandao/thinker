/**
 * Jest `setupFiles` for the e2e suite (#27). `THINKER_ENCRYPTION_KEY` is
 * required and has no fallback to `BETTER_AUTH_SECRET`, so every spec (and any
 * server it spawns from `process.env`) gets a test-only key unless the runner
 * already set one. It differs from every test `BETTER_AUTH_SECRET`.
 */
process.env['THINKER_ENCRYPTION_KEY'] ??= 'e2e-test-encryption-key-at-least-32-characters';
