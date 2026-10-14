---
---

`THINKER_ENCRYPTION_KEY` is required and separate from `BETTER_AUTH_SECRET` (#27): the server refuses to start when it is missing, shorter than 32 characters or equal to `BETTER_AUTH_SECRET`, and at-rest encryption never falls back to the session secret. Ships inside 0.1.0; to be listed in docs/releases/0.1.0.md.
