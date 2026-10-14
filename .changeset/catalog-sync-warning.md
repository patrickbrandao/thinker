---
'thinker': patch
---

`THINKER_CATALOG_SYNC` now logs one warning at boot when its value is not recognized (sync stays on), and the "sync disabled" log lines show the configured value. The MCP routing status tool no longer reports `pricing_cache_empty` for an agent that can route, matching the REST endpoint.
