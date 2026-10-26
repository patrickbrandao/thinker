---
'thinker': patch
---

Virtual models, part 3 (ADR 0004): `GET /v1/models` now lists `auto`, then the key's agent's enabled virtual models (in their configured order), then the real models. A real model whose id matches a virtual model's name, ignoring case, is hidden while that virtual model is enabled. `auto` and virtual models publish `context_length`, the smallest context window among the routes that can serve them, and omit it when any of those windows is unknown. They never carry `capabilities`, `cost` or route metadata.
