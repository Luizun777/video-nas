import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import type { DownloadEntry, DownloadsFile, PlayResult } from '@shared/types'
import { JsonStore } from '@core/stores/json-store'
import { getConfig, getServerById } from '@core/stores/config-store'
import { getItem } from '@core/stores/library-store'
import { nodeStoreIO } from '../adapters/node-store-io'
import { resolveNasPath } from '../nas/mount-manager'

const PROGRESS_THROTTLE_MS = 500
/** Margen sobre el tamaño del archivo para no dejar el disco completamente lleno. */
const FREE_SPACE_MARGIN = 1.05
/** Señal interna para distinguir una cancelación deliberada de un error real de red/IO. */
const CANCELLED = 'CANCELLED'

let store: JsonStore<DownloadsFile>

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
  return getConfig().downloadsPath ?? join(app.getPath('videos'), 'Video NAS')
}

function keyOf(itemId: string, relPath: string): string {
  return `${itemId}::${relPath}`
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
  try {
    const stats = await fs.statfs(getDownloadsPath())
    const freeBytes = stats.bavail * stats.bsize
    return freeBytes > bytes * FREE_SPACE_MARGIN
  } catch {
    // No se pudo comprobar (ruta aún no existe, filesystem no lo soporta): no bloqueamos.
    return true
  }
}

/** Aborta la copia en curso de `key`, si la hay. Ver runDownload/copyFile más abajo. */
const activeAborts = new Map<string, () => void>()

async function copyFile(
  key: string,
  srcPath: string,
  partPath: string,
  totalBytes: number,
  onProgress: (bytesDone: number) => void
): Promise<void> {
  const readStream = createReadStream(srcPath)
  const writeStream = createWriteStream(partPath)

  let bytesDone = 0
  let lastEmit = 0
  readStream.on('data', (chunk: Buffer) => {
    bytesDone += chunk.length
    const now = Date.now()
    if (now - lastEmit >= PROGRESS_THROTTLE_MS || bytesDone >= totalBytes) {
      lastEmit = now
      onProgress(bytesDone)
    }
  })

  activeAborts.set(key, () => readStream.destroy(new Error(CANCELLED)))
  try {
    await pipeline(readStream, writeStream)
  } finally {
    activeAborts.delete(key)
  }
}

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

  const resolved = await resolveNasPath(server, entry.relPath)
  if ('error' in resolved) return void (await failEntry(key, resolved.error))

  updateEntry(key, { state: 'downloading' })
  const partPath = `${entry.localPath}.part`
  await fs.mkdir(dirname(entry.localPath), { recursive: true })

  try {
    await copyFile(key, resolved.absPath, partPath, entry.totalBytes, (bytesDone) => {
      updateEntry(key, { bytesDone })
    })
    await fs.rename(partPath, entry.localPath)
    updateEntry(key, {
      state: 'done',
      bytesDone: entry.totalBytes,
      finishedAt: new Date().toISOString()
    })
    await store.flush()
  } catch (error) {
    await fs.unlink(partPath).catch(() => {})
    if ((error as Error).message === CANCELLED) {
      removeEntry(key)
    } else {
      await failEntry(key, `Error al copiar el archivo: ${(error as Error).message}`)
    }
  }
}

export async function startDownload(itemId: string, relPath?: string): Promise<PlayResult> {
  const item = getItem(itemId)
  if (!item) return { ok: false, error: 'No se encontró el título en la biblioteca.' }

  const target = relPath ?? item.videoRelPath ?? item.episodes?.[0]?.relPath ?? item.relPath
  const key = keyOf(itemId, target)

  const existing = store.get().entries[key]
  if (existing && existing.state !== 'error') {
    return { ok: true } // ya en curso o completada: idempotente
  }

  const server = getServerById(item.serverId)
  if (!server) return { ok: false, error: 'El servidor de este título ya no está configurado.' }

  const resolved = await resolveNasPath(server, target)
  if ('error' in resolved) return { ok: false, error: resolved.error }

  let totalBytes: number
  try {
    totalBytes = (await fs.stat(resolved.absPath)).size
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo de origen en el NAS.' }
  }

  if (!(await hasEnoughSpace(totalBytes))) {
    return { ok: false, error: 'No hay suficiente espacio libre en el disco para esta descarga.' }
  }

  const localPath = uniqueLocalPath(join(getDownloadsPath(), target), key)

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

  const abort = activeAborts.get(key)
  if (abort) {
    abort() // dispara el catch de runDownload, que borra la entrada y el .part
    return
  }

  const queueIndex = queue.indexOf(key)
  if (queueIndex !== -1) queue.splice(queueIndex, 1)
  await fs.unlink(`${entry.localPath}.part`).catch(() => {})
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

  await fs.unlink(entry.localPath).catch(() => {})
  removeEntry(key)
}

/** Ruta local si ya está descargada. Si el usuario borró el archivo por fuera, se limpia sola. */
export function getLocalCopy(itemId: string, relPath: string): string | null {
  const key = keyOf(itemId, relPath)
  const entry = store.get().entries[key]
  if (!entry || entry.state !== 'done') return null
  if (!existsSync(entry.localPath)) {
    removeEntry(key)
    return null
  }
  return entry.localPath
}

export async function initDownloadManager(): Promise<void> {
  store = new JsonStore<DownloadsFile>(nodeStoreIO, 'downloads.json', { version: 1, entries: {} })
  const data = await store.load()

  // Descargas que quedaron a medias al cerrar la app: no se reanudan solas, se marcan
  // como error para que el usuario decida si reintenta.
  let dirty = false
  for (const entry of Object.values(data.entries)) {
    if (entry.state === 'queued' || entry.state === 'downloading') {
      entry.state = 'error'
      entry.error = 'Descarga interrumpida al cerrar la app.'
      dirty = true
      void fs.unlink(`${entry.localPath}.part`).catch(() => {})
    }
  }
  if (dirty) {
    store.set(data)
    await store.flush()
  }

  await fs.mkdir(getDownloadsPath(), { recursive: true }).catch(() => {})
}
