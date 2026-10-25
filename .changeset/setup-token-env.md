---
'thinker': patch
---

New `THINKER_SETUP_TOKEN` env var: the operator can choose the first-setup token (16+ characters) and hand it over without reading the server log. It is never logged. Without it, a random one-time token is still printed to the log.
