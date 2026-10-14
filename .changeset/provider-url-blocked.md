---
'thinker': patch
---

A provider URL refused by the SSRF policy (a cloud metadata address) now fails the attempt with HTTP 502 and `error.code: "provider_url_blocked"` instead of a generic internal error, and fallbacks still run. Post-deploy backfills use the direct database URL (`MIGRATION_DATABASE_URL`, `DATABASE_UNPOOLED_URL` or `BACKFILL_DATABASE_URL`) when one is set.
