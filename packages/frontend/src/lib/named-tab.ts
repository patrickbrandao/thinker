/**
 * Opens `path` in the browser tab named `name`, reusing it when it is already
 * open: a second click brings that tab forward instead of opening another
 * one, and doesn't reload it when it already shows `path`.
 */
export function openNamedTab(path: string, name: string): void {
  const tab = window.open('', name);
  if (!tab) {
    // Pop-up blocked: fall back to a plain new tab.
    window.open(path, '_blank', 'noopener');
    return;
  }
  let current = '';
  try {
    current = tab.location.pathname;
  } catch {
    // Another origin took the name: navigate it anyway.
  }
  if (current !== path) tab.location.href = path;
  tab.focus();
}
