---
'thinker': patch
---

Disconnecting, disabling for a harness or removing (custom provider) a provider that a virtual model routes to is now refused with 409, as it already was for tiers. Any override or fallback of a virtual model counts, enabled or disabled; routes inherited through Continue on Default do not, since the `default` tier guard already covers them. The 409 message names the virtual model (`agent "…", virtual model "…", primary: …`). The disable-impact endpoint (`GET /api/v1/agents/:agent/enabled-providers/:id/impact`) gains `affected_virtual_models` (id, name, agent, model, position) next to `affected_tiers`, the MCP `thinker_agent_provider_disable` tool applies the same guard, and the dashboard names the virtual models when it blocks a disable (ADR 0004, #176).
