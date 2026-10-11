/**
 * Endpoints derived from the origin this dashboard is served from.
 *
 * The dashboard and API ship as one service, so the browser origin is the
 * install's own address.
 *
 * Under the Vite dev server the dashboard runs on its own port, so these read as
 * the dev server's origin rather than the backend's. That is a dev-only artifact
 * and matches the behaviour of the snippets mentioned above.
 */
export function installOrigin(): string {
  return window.location.origin;
}

/** Where an MCP client should be pointed. */
export function mcpEndpoint(): string {
  return `${installOrigin()}/api/v1/mcp`;
}
