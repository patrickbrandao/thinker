/**
 * Public documentation for Thinker's own error codes (`M001`, `M100`, …).
 *
 * The code catalogue itself lives backend-side in
 * `packages/backend/src/common/errors/error-codes.ts` — only the docs base URL
 * is shared, because the dashboard renders a "read the docs" link from the
 * `error_code` persisted on a message row and must not re-declare the URL.
 */
export const THINKER_ERRORS_DOCS_BASE =
  'https://github.com/patrickbrandao/thinker/blob/main/docs/erros.md';

/** Deep link to the documentation page for one Thinker error code. */
export function thinkerErrorDocsUrl(code: string): string {
  return `${THINKER_ERRORS_DOCS_BASE}#${code.toLowerCase()}`;
}
