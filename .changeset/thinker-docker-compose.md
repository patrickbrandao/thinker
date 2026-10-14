---
---

Rebrand the Docker image, Compose file and installer to Thinker (#26): project and service `thinker`, Postgres `thinker`, volumes `thinker_pgdata`/`thinker_request_recordings`, installer variables `THINKER_INSTALLER_SOURCE`/`THINKER_INSTALLER_SKIP_PULL` and default directory `$HOME/thinker`, backend default port 2099, `TRUST_PROXY=loopback` in Compose, and `/app/LICENSE` plus `/app/THIRD_PARTY_NOTICES` in the image. Ships inside 0.1.0.
