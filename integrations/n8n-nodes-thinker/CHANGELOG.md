# Changelog

## 0.1.0

- First release as `n8n-nodes-thinker`, forked from the upstream n8n node: the **Thinker** action node, the **Thinker Chat Model** sub-node (`lmChatThinker`) and the **Thinker API** credential (`thinkerApi`).
- The base URL defaults to a local Thinker instance, `http://localhost:2099`.
- The nodes refuse an API key that does not start with `thk_` before sending any request.
- Requests identify the node with `User-Agent: n8n-nodes-thinker`.
- Provisional logo until the Thinker brand assets land.
