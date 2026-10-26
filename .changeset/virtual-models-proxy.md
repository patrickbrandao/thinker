---
'thinker': patch
---

Virtual models, part 2 (ADR 0004): the proxy now accepts a virtual model name in `model` on `/v1/chat/completions`, `/v1/responses` and `/v1/messages`. An enabled virtual model comes first, ahead of header tiers, and routes through its own chain, then through the Default tier's chain when "continue on Default" is on, with runtime fallback. A chain with no available route answers the new error M301. Responses carry `X-Thinker-Reason: virtual-model` and `X-Thinker-Virtual-Model`, message log rows record the virtual model, and per-model parameters apply per route (`virtual:<id>` for its own routes, `tier:default` for the borrowed ones). Header tiers, `auto`, heartbeats and `POST /api/v1/routing/resolve` keep their behavior.
