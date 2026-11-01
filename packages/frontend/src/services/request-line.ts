/**
 * The backend stores the inbound request line as HTTP/2-style pseudo-headers
 * (`:method`, `:path`, `:version`) alongside the received headers. Split them
 * back into `POST /v1/messages HTTP/1.1` and the ordinary headers.
 */
export function splitRequestLine(headers: Record<string, string>): {
  requestLine: string | null;
  rest: Record<string, string>;
} {
  const { ':method': method, ':path': path, ':version': version, ...rest } = headers;
  const parts = [method, path, version].filter((p): p is string => Boolean(p));
  return { requestLine: parts.length > 0 ? parts.join(' ') : null, rest };
}
