---
'thinker': patch
---

Virtual models, part 4 (ADR 0004): the harness Routing page has a "Virtual models" section, separate from the custom tiers. Each card shows the name, the primary model and up to 5 fallbacks, and switches for active, "Continue on Default" and stream mode, plus a warning when the name shadows a real model id. The create/edit modal checks the name live with the backend's rule and shows backend errors next to the field or the model they concern. Cards reorder by drag (or the arrow keys on the handle), and each one has a copyable example with the harness's base URL and `model: "<name>"`. The message log and the message details show the virtual model a request used. Harness setup screens list the active virtual models as values of `model` next to `auto`, and the SDK snippets can switch to one.
