---
'thinker': patch
---

Virtual models, part 5 (ADR 0004): virtual models in the MCP server and the `thinker` CLI. New MCP tools `thinker_routing_virtual_list`, `_create`, `_update` and `_delete`, and CLI commands `thinker routing virtual list|create|update|delete|enable|disable` (`--model`, repeatable `--fallback`, `--continue-on-default`; `delete` needs `--yes`). `thinker_routing_status` and `thinker routing status` list the virtual models, and `thinker_routing_test` / `thinker routing test --model <virtual>` report the virtual model and routing reason the request went through. Model params can be addressed by virtual model with the `virtual` field of `thinker_routing_params_get`/`_set` and `--virtual` on `thinker routing params get|set`, both exclusive with the tier selector, through the new `GET|PATCH /api/v1/routing/:agent/virtual-model-params?virtual=<name>` endpoint (scope `virtual:<id>`). The CLI agent skill documents them.
