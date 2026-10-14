---
'thinker': patch
---

Boot now fails with a clear message when `EMAIL_PROVIDER` is set without `EMAIL_FROM`. A fresh database no longer logs a false Better Auth "Database schema mismatch / Missing tables" error on first boot; a real mismatch after the Better Auth migration is still logged. An upstream 502 that sends `code: "provider_url_blocked"` is no longer reported as a gateway SSRF block.
