---
"thinker": major
---

Rename client-visible identifiers to Thinker names (#21). Environment variables now use the `THINKER_*` prefix (for example `THINKER_ENCRYPTION_KEY`, `THINKER_RATE_MAX_REQUESTS`, `THINKER_DISABLE_HSTS`), new agent keys use the `thk_` prefix, and request headers use `x-thinker-*` (for example `x-thinker-tier`). The old `MANIFEST_*` names are not read: the server logs a warning naming any that are still set, and refuses to start when the old encryption key variable is set without `THINKER_ENCRYPTION_KEY`, so stored provider credentials are never left undecryptable. Rename the variables in your `.env` (same values) before upgrading. The CLI now sends `x-thinker-tier`, and the Docker Compose file reads `THINKER_VERSION` and pulls `tmsoftbrasil/thinker`.
