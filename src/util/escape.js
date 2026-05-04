// ─── HTML escape ───
//
// Canonical browser-side XSS-safe escape: write the untrusted string
// as textContent into a throwaway element, then read back its
// innerHTML. The browser's own HTML serializer handles all the edge
// cases (named entities, surrogate pairs, etc.) so we don't have to
// maintain a hand-rolled mapping.

export function escapeHtml(str) {
  const sandbox = document.createElement('div');
  sandbox.textContent = str;
  return sandbox.innerHTML;
}
