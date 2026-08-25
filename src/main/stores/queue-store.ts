import type { QueueEntry, QueueFile } from '@shared/types'
import { JsonStore } from './json-store'
import { getItem } from './library-store'

// La cola vive en main a propósito: la comparten la ventana principal y la ventana
// separada del reproductor, y shiftQueue debe ser atómico entre ambas (main es mono-hilo
// e ipcMain.handle serializa, así que dos ventanas nunca sacan la misma entrada).

let store: JsonStore<QueueFile>

export async function initQueueStore(): Promise<QueueFile> {
  store = new JsonStore<QueueFile>('queue.json', { version: 1, entries: [] })
  const data = await store.load()
  if (!Array.isArray(data.entries)) data.entries = []
  return data
}

export function getQueue(): QueueEntry[] {
  return store.get().entries
}

/** Idempotente: si el título ya está en la cola, no hace nada. */
export function addToQueue(itemId: string): QueueEntry[] {
  store.update((draft) => {
    if (!draft.entries.some((entry) => entry.itemId === itemId)) {
      draft.entries.push({ itemId, addedAt: new Date().toISOString() })
    }
  })
  return getQueue()
}

export function removeFromQueue(itemId: string): QueueEntry[] {
  store.update((draft) => {
    draft.entries = draft.entries.filter((entry) => entry.itemId !== itemId)
  })
  return getQueue()
}

export function clearQueue(): QueueEntry[] {
  store.update((draft) => {
    draft.entries = []
  })
  return getQueue()
}

/**
 * Saca la primera entrada válida de la cola: descarta de la cabeza las que sean
 * `skipItemId` (lo que se está reproduciendo no debe seguirse a sí mismo) o apunten a
 * items que ya no existen o están missing en la biblioteca.
 */
export function shiftQueue(skipItemId?: string): QueueEntry | null {
  let result: QueueEntry | null = null
  store.update((draft) => {
    while (draft.entries.length > 0) {
      const head = draft.entries.shift()!
      if (head.itemId === skipItemId) continue
      const item = getItem(head.itemId)
      if (!item || item.missing) continue
      result = head
      break
    }
  })
  return result
}

export function flushQueue(): Promise<void> {
  return store.flush()
}
