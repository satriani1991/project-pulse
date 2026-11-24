import { useSyncExternalStore } from 'react';
import { WORKSPACE_ID } from './workspace';

export type ThemeMode = 'dark' | 'light' | 'system';
interface UiState { addProject: boolean; discover: boolean; palette: boolean; notifications: boolean; sidebarCollapsed: boolean; deployProjectId: string | null; theme: ThemeMode; resolvedTheme: 'dark' | 'light' }
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const THEME_KEY = `pulse-theme:${WORKSPACE_ID}`;
const storedTheme = (): ThemeMode | null => { try { const v = localStorage.getItem(THEME_KEY); return v === 'dark' || v === 'light' || v === 'system' ? v : null; } catch { return null; } };
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : undefined;
const resolve = (m: ThemeMode): 'dark' | 'light' => (m === 'system' ? (media?.matches ? 'light' : 'dark') : m);

const initialTheme = storedTheme() ?? 'dark';
let state: UiState = { addProject: false, discover: false, palette: false, notifications: false, sidebarCollapsed: read('pulse-sidebar', false), deployProjectId: null, theme: initialTheme, resolvedTheme: resolve(initialTheme) };
const subs = new Set<() => void>();
document.documentElement.dataset.theme = state.resolvedTheme;

export function setUi(patch: Partial<UiState>) {
  if (patch.theme) {
    patch.resolvedTheme = resolve(patch.theme);
    document.documentElement.dataset.theme = patch.resolvedTheme;
    try { localStorage.setItem(THEME_KEY, patch.theme); } catch { /* ignore */ }
  }
  state = { ...state, ...patch };
  if (patch.sidebarCollapsed !== undefined) try { localStorage.setItem('pulse-sidebar', JSON.stringify(patch.sidebarCollapsed)); } catch { /* ignore */ }
  subs.forEach((s) => s());
}
media?.addEventListener('change', () => { if (state.theme === 'system') setUi({ theme: 'system' }); });

/** Adopt the workspace's saved theme the first time this browser opens the workspace. */
export function adoptWorkspaceTheme(t: ThemeMode) { if (!storedTheme() && t !== state.theme) setUi({ theme: t }); }

export function useUi<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}
