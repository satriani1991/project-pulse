/** Tiny in-process hook bus to keep services decoupled (avoids circular imports). */
export interface ScanResult {
  projectId: string;
  initial: boolean;
  created: string[];
  modified: string[];
  deleted: string[];
  renamed: { from: string; to: string }[];
  deployChanged: boolean;
  buildChanged: boolean;
  assetChanged: boolean;
  gitDirty: boolean;
}

type Hook = (r: ScanResult) => void | Promise<void>;
const afterScan: Hook[] = [];
export function onAfterScan(h: Hook) { afterScan.push(h); }
export async function runAfterScan(r: ScanResult) {
  for (const h of afterScan) { try { await h(r); } catch (e) { console.error('[hook]', (e as Error).message); } }
}
