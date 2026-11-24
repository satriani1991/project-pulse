import type { WebSocket } from 'ws';
import type { WsMessage } from '@pulse/shared';
import { currentWs } from '../workspace/context.js';

const clients = new Map<WebSocket, string>();
const listeners = new Set<(m: WsMessage, ws: string) => void>();

export function addClient(socket: WebSocket, ws: string) {
  clients.set(socket, ws);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

/** Broadcast to dashboard tabs viewing the current workspace; also notifies in-process listeners. */
export function broadcast(type: string, projectId?: string, data?: unknown) {
  const ws = currentWs();
  const msg: WsMessage = { type, projectId, data, at: new Date().toISOString() };
  const text = JSON.stringify(msg);
  for (const [socket, w] of clients) {
    if (w !== ws && type !== 'workspaces.updated') continue;
    try { if (socket.readyState === 1) socket.send(text); } catch { clients.delete(socket); }
  }
  for (const l of listeners) { try { l(msg, ws); } catch { /* ignore */ } }
}
export function onBroadcast(fn: (m: WsMessage, ws: string) => void) { listeners.add(fn); return () => listeners.delete(fn); }
export const clientCount = () => clients.size;
