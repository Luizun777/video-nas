import { ipcMain } from 'electron'

/**
 * Los handlers de ipc.ts se registran aquí además de en ipcMain: el servidor LAN los
 * reutiliza tal cual (UNA sola implementación de cada operación para la ventana de
 * Electron y para los navegadores de la red). Los eventos que main manda a las
 * ventanas también llegan a los navegadores por SSE.
 */

/** Lo que recibe el handler en lugar del IpcMainInvokeEvent cuando llama la LAN. */
export interface LanCaller {
  lanClient: string
}

type Handler = (event: unknown, ...args: any[]) => unknown

const handlers = new Map<string, Handler>()
const broadcastListeners = new Set<(channel: string, payload: unknown) => void>()

export function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, handler)
  handlers.set(channel, handler)
}

export function getHandler(channel: string): Handler | undefined {
  return handlers.get(channel)
}

/** 'desktop' para la ventana de Electron, 'lan:<ip>' para un navegador. */
export function callerId(event: unknown): string {
  const lanClient = (event as Partial<LanCaller> | null)?.lanClient
  return lanClient ? `lan:${lanClient}` : 'desktop'
}

export function onBroadcast(listener: (channel: string, payload: unknown) => void): () => void {
  broadcastListeners.add(listener)
  return () => broadcastListeners.delete(listener)
}

export function emitBroadcast(channel: string, payload: unknown): void {
  for (const listener of broadcastListeners) listener(channel, payload)
}
