# thinker

This package exists to hold the canonical **Thinker release version**.

It contains no code. The real backend and frontend live in [`../backend`](../backend) and [`../frontend`](../frontend), and shared types in [`../shared`](../shared). The Docker image `tmsoftbrasil/thinker` bundles the built backend + frontend.

## What it's for

- **Release version**: `scripts/ship.sh` bumps the `version` field here, and the release workflow (or the local publish fallback) tags the image with it.
- **Changelog**: `CHANGELOG.md` holds the history up to 0.1.2. Later releases are described only in `docs/releases/X.Y.Z.md`.
