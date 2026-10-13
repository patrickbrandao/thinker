---
---

Rename the management CLI to `thinker` (#23): package `thinker-cli` (private, installed from the repository), `THINKER_URL` / `THINKER_API_KEY` / `THINKER_AGENT_KEY` / `THINKER_AGENT_URL` with no legacy aliases, state in `~/.config/thinker/`, User-Agent `thinker-cli/<version>`, and the `thinker-cli` agent skill. The old `~/.config/manifest/` directory (stored logins, cached agent keys, leftover telemetry files) is no longer read and can be deleted. Ships inside 0.1.0.
