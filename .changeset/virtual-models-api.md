---
'thinker': patch
---

Virtual models, part 1 (ADR 0004): new `virtual_models` table and admin API at `/api/v1/routing/:agentName/virtual-models` to create, edit, enable, reorder and delete per-harness model names with a primary, up to 5 fallbacks and "continue on Default". Routes are validated strictly when saved, and the listing shows which real model ids each name shadows and its context window. The proxy does not use them yet.
