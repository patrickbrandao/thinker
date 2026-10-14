---
'thinker': patch
---

Custom providers that stored a now-reserved alias (such as `lmstudio` or `llamacpp`) are moved to `<alias>-custom` on upgrade, so they no longer shadow the built-in route; clients that used the old `<alias>/<model>` id must switch to the new alias (the rename is logged). `THINKER_LMSTUDIO_BASE_URL` and `THINKER_LLAMACPP_BASE_URL` now reject an empty trailing `?` or `#`, and the Docker Compose file passes both variables to the container.
