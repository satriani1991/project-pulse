import type { WsMessage } from '@pulse/shared';
import { WORKSPACE_ID } from '../stores/workspace';

type Listener = (m: WsMessage) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | undefined;
let retry = 0;
let connected = false;
const statusListeners = new Set<(c: boolean) => void>();

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?ws=${encodeURIComponent(WORKSPACE_ID)}`);
  ws.onopen = () => { retry = 0; connected = true; statusListeners.forEach((l) => l(true)); };
  ws.onmessage = (e) => { try { const m = JSON.parse(e.data) as WsMessage; listeners.forEach((l) => l(m)); } catch { /* ignore */ } };
  ws.onclose = () => { connected = false; statusListeners.forEach((l) => l(false)); setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++)); };
}

export function subscribe(l: Listener) { if (!ws) connect(); listeners.add(l); return () => { listeners.delete(l); }; }
export function onConnection(l: (c: boolean) => void) { statusListeners.add(l); l(connected); return () => { statusListeners.delete(l); }; }
