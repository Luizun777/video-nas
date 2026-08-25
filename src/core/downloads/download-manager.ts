import type { DownloadEntry, DownloadsFile, PlayResult } from '@shared/types'
import type { DownloadTransfer, StoreIO } from '../io'
import { JsonStore } from '../stores/json-store'
import { getConfig, getServerById } from '../stores/config-store'
import { getItem } from '../stores/library-store'
import { pickTargetRelPath } from '../playback/resolve-target'

/** Margen sobre el tamaño del archivo para no dejar el disco completamente lleno. */
const FREE_SPACE_MARGIN = 1.05
/** Señal para distinguir una cancelación deliberada de un error real de red/IO. */
export const DOWNLOAD_CANCELLED = 'CANCELLED'

let store: JsonStore<DownloadsFile>
let transfer: DownloadTransfer

export type DownloadsListener = (entries: DownloadEntry[]) => void
const listeners = new Set<DownloadsListener>()

export function onDownloadsChanged(listener: DownloadsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  const entries = getDownloads()
  for (const listener of listeners) listener(entries)
}

export function getDownloads(): DownloadEntry[] {
  return Object.values(store.get().entries)
}

function getDownloadsPath(): string {
  // initConfigStore siempre deja downloadsPath resuelto antes de que esto corra.
  return getConfig().downloadsPath!
}

function keyOf(itemId: string, relPath: string): string {
  return `${itemId}::${relPath}`
}

/** dirname POSIX suficiente para rutas construidas con "/" (sin fs ni node:path). */
function parentDir(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : path
}

function updateEntry(key: string, patch: Partial<DownloadEntry>): void {
  store.update((draft) => {
    const entry = draft.entries[key]
    if (entry) Object.assign(entry, patch)
  })
  emit()
}

function removeEntry(key: string): void {
  store.update((draft) => {
    delete draft.entries[key]
  })
  void store.flush()
  emit()
}

async function failEntry(key: string, message: string): Promise<void> {
  updateEntry(key, { state: 'error', error: message })
  await store.flush()
}

/** Ningún dos descargas comparten ruta local: si ya está tomada, se sufija " (2)", " (3)"… */
function uniqueLocalPath(basePath: string, ownKey: string): string {
  const taken = new Set(
    Object.values(store.get().entries)
      .filter((entry) => entry.key !== ownKey)
      .map((entry) => entry.localPath)
  )
  if (!taken.has(basePath)) return basePath

  const dot = basePath.lastIndexOf('.')
  const stem = dot > 0 ? basePath.slice(0, dot) : basePath
  const ext = dot > 0 ? basePath.slice(dot) : ''
  let attempt = 2
  let candidate = `${stem} (${attempt})${ext}`
  while (taken.has(candidate)) {
    attempt++
    candidate = `${stem} (${attempt})${ext}`
  }
  return candidate
}

async function hasEnoughSpace(bytes: number): Promise<boolean> {
  const free = await transfer.freeBytes(getDownloadsPath())
  // null = no se pudo comprobar (ruta aún no existe, fs sin statfs): no bloqueamos.
  if (free === null) return true
  return free > bytes * FREE_SPACE_MARGIN
}

/** Claves con copia en curso: cancelDownload decide entre abortar o limpiar la cola. */
const activeKeys = new Set<string>()

const queue: string[] = []
let processing = false

function enqueue(key: string): void {
  queue.push(key)
  void processQueue()
}

async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  while (queue.length > 0) {
    const key = queue.shift()!
    const entry = store.get().entries[key]
    if (!entry || entry.state !== 'queued') continue // se canceló mientras esperaba turno
    await runDownload(key)
  }
  processing = false
}

async function runDownload(key: string): Promise<void> {
  const entry = store.get().entries[key]
  if (!entry) return

  const item = getItem(entry.itemId)
  if (!item) return void (await failEntry(key, 'El título ya no existe en la biblioteca.'))

  const server = getServerById(item.serverId)
  if (!server) return void (await failEntry(key, 'El servidor de este título ya no está configurado.'))

  const source = await transfer.statSource(server, entry.relPath)
  if ('error' in source) return void (await failEntry(key, source.error))

  updateEntry(key, { state: 'downloading' })
  const partPath = `${entry.localPath}.part`
  await transfer.ensureDir(parentDir(entry.localPath))

  activeKeys.add(key)
  try {
    await transfer.copy({
      key,
      server,
      relPath: entry.relPath,
      partPath,
      totalBytes: entry.totalBytes,
      onProgress: (bytesDone) => updateEntry(key, { bytesDone })
    })
    await transfer.finalize(partPath, entry.localPath)
    updateEntry(key, {
      state: 'done',
      bytesDone: entry.totalBytes,
      finishedAt: new Date().toISOString()
    })
    await store.flush()
  } catch (error) {
    await transfer.deleteFile(partPath).catch(() => {})
    if ((error as Error).message === DOWNLOAD_CANCELLED) {
      removeEntry(key)
    } else {
      await failEntry(key, `Error al copiar el archivo: ${(error as Error).message}`)
    }
  } finally {
    activeKeys.delete(key)
  }
}

export async function startDownload(itemId: string, relPath?: string): Promise<PlayResult> {
  const item = getItem(itemId)
  if (!item) return { ok: false, error: 'No se encontró el título en la biblioteca.' }

  const target = pickTargetRelPath(item, relPath)
  const key = keyOf(itemId, target)

  const existing = store.get().entries[key]
  if (existing && existing.state !== 'error') {
    return { ok: true } // ya en curso o completada: idempotente
  }

  const server = getServerById(item.serverId)
  if (!server) return { ok: false, error: 'El servidor de este título ya no está configurado.' }

  const source = await transfer.statSource(server, target)
  if ('error' in source) return { ok: false, error: source.error }
  const totalBytes = source.size

  if (!(await hasEnoughSpace(totalBytes))) {
    return { ok: false, error: 'No hay suficiente espacio libre en el disco para esta descarga.' }
  }

  const localPath = uniqueLocalPath(`${getDownloadsPath()}/${target}`, key)

  store.update((draft) => {
    draft.entries[key] = {
      key,
      itemId,
      relPath: target,
      localPath,
      totalBytes,
      bytesDone: 0,
      state: 'queued',
      startedAt: new Date().toISOString()
    }
  })
  await store.flush()
  emit()
  enqueue(key)
  return { ok: true }
}

export async function cancelDownload(itemId: string, relPath: string): Promise<void> {
  const key = keyOf(itemId, relPath)
  const entry = store.get().entries[key]
  if (!entry) return

  if (activeKeys.has(key)) {
    transfer.cancel(key) // dispara el catch de runDownload, que borra la entrada y el .part
    return
  }

  const queueIndex = queue.indexOf(key)
  if (queueIndex !== -1) queue.splice(queueIndex, 1)
  await transfer.deleteFile(`${entry.localPath}.part`).catch(() => {})
  removeEntry(key)
}

export async function deleteDownload(itemId: string, relPath: string): Promise<void> {
  const key = keyOf(itemId, relPath)
  const entry = store.get().entries[key]
  if (!entry) return

  if (entry.state === 'downloading' || entry.state === 'queued') {
    await cancelDownload(itemId, relPath)
    return
  }

  await transfer.deleteFile(entry.localPath).catch(() => {})
  removeEntry(key)
}

/**
 * Ruta local si ya está descargada. Consulta solo el estado en memoria (síncrona a
 * propósito: la URL de streaming de Android se construye sin await). La validación de
 * que el archivo siga existiendo corre en init y en quien reproduce.
 */
export function getLocalCopy(itemId: string, relPath: string): string | null {
  const entry = store.get().entries[keyOf(itemId, relPath)]
  return entry && entry.state === 'done' ? entry.localPath : null
}

export async function initDownloadManager(io: StoreIO, downloadTransfer: DownloadTransfer): Promise<void> {
  transfer = downloadTransfer
  store = new JsonStore<DownloadsFile>(io, 'downloads.json', { version: 1, entries: {} })
  const data = await store.load()

  let dirty = false

  // Descargas que quedaron a medias al cerrar la app: no se reanudan solas, se marcan
  // como error para que el usuario decida si reintenta.
  for (const entry of Object.values(data.entries)) {
    if (entry.state === 'queued' || entry.state === 'downloading') {
      entry.state = 'error'
      entry.error = 'Descarga interrumpida al cerrar la app.'
      dirty = true
      void transfer.deleteFile(`${entry.localPath}.part`).catch(() => {})
    }
  }

  // Copias que el usuario borró por fuera: se podan aquí (getLocalCopy ya no toca disco).
  for (const entry of Object.values(data.entries)) {
    if (entry.state !== 'done') continue
    if (!(await transfer.exists(entry.localPath))) {
      delete data.entries[entry.key]
      dirty = true
    }
  }

  if (dirty) {
    store.set(data)
    await store.flush()
  }

  await transfer.ensureDir(getDownloadsPath()).catch(() => {})
}
