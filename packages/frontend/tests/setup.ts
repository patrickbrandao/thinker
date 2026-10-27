import { beforeEach } from 'vitest';
import { invalidateAll } from '../src/services/api/cache';
import { resetLocaleForTests } from '../src/i18n';

// Tests run in English (the reference locale) unless a test switches to
// pt-BR on purpose with `resetLocaleForTests('pt-BR')`.
beforeEach(() => {
  resetLocaleForTests('en');
});

// The SWR GET cache (src/services/api/cache.ts) is a module-level singleton that
// persists across tests in the same file. Reset it before every test so a cached
// payload from one test never satisfies a GET in another (test isolation), the
// same way fetch mocks are reset between tests.
beforeEach(() => {
  invalidateAll();
});
