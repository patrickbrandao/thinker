/**
 * Shape a translation must follow: same keys as the English reference, with
 * strings (any wording) and functions (same arguments) in the same places.
 */
export type Catalog<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => string
      ? (...args: A) => string
      : Catalog<T[K]>;
};
