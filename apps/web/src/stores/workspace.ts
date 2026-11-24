/**
 * Active workspace for THIS browser tab.
 * Priority: ?ws= in the URL → this tab (sessionStorage) → this browser (localStorage) → "default".
 * Different browsers (or tabs) can therefore show different workspaces at the same time.
 */
const KEY = 'pulse-workspace';
function read(): string {
  try {
    const url = new URL(location.href);
    const q = url.searchParams.get('ws');
    if (q) {
      sessionStorage.setItem(KEY, q); localStorage.setItem(KEY, q);
      url.searchParams.delete('ws');
      history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
      return q;
    }
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY) ?? 'default';
  } catch { return 'default'; }
}
export const WORKSPACE_ID = read();

/** Switch workspace: remembered for this tab and as this browser's default, then reload into it. */
export function switchWorkspace(id: string) {
  try { sessionStorage.setItem(KEY, id); localStorage.setItem(KEY, id); } catch { /* ignore */ }
  location.assign('/');
}
/** Reset to default when the stored workspace no longer exists. */
export function forgetWorkspace() {
  try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* ignore */ }
  location.assign('/');
}
export const openWorkspaceInNewTab = (id: string) => window.open(`/?ws=${encodeURIComponent(id)}`, '_blank', 'noopener');
