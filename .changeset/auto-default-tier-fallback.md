---
"thinker": patch
---

`model: "auto"` now falls back to the default tier when complexity routing is on and the scored tier has no model set. A tier whose configured model is unavailable still returns an error instead of falling back. When it cannot route, M101 says which tier it checked and what is missing.
