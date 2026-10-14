/**
 * JSON for bodies that may carry upstream or exception text (SSE frames,
 * friendly error envelopes). Identical to `JSON.stringify` for any JSON
 * parser, but `<`, `>`, `&`, U+2028 and U+2029 are written as `\uXXXX`
 * escapes, so the bytes can never be interpreted as HTML or script even if a
 * client ignores the declared Content-Type.
 */
export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
