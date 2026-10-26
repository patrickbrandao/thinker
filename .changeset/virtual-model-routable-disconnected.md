---
'thinker': patch
---

Fix (#197): a virtual model whose routes all belong to a provider the agent no longer has (disconnected, or disabled for the agent) is no longer reported as routable. The virtual model listing (`routable`), `thinker routing status` and `thinker_routing_status` (`routes_by_virtual_model`, `active_virtual_models`) now judge a route with no discovered models the way the proxy does: it counts only when the agent has an active, usable record for its provider. A connected provider whose discovery has no models yet still counts, with an unknown window. The same rule applies to `context_length` (virtual model listing and `GET /v1/models`, virtual models and `auto`): a route of a removed provider no longer enters the calculation, so the published window is the smallest among the routes that can actually serve the request (ADR 0004, section 7).
