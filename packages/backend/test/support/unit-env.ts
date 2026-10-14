/**
 * Jest `setupFiles` for the unit suite (#27). `THINKER_ENCRYPTION_KEY` is
 * required and has no fallback, so every spec starts with a test-only key.
 * Specs that cover a missing or invalid key delete or override it themselves.
 */
process.env['THINKER_ENCRYPTION_KEY'] ??= 'unit-test-encryption-key-at-least-32-characters';
