import { create } from 'zustand'
import type {
  AppConfig,
  DownloadEntry,
  Library,
  LibraryItem,
  PlayTarget,
  QueueEntry,
  ScanProgress,
  ServerStatus
} from '@shared/types'

interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
}

interface AppState {
  config: AppConfig | null
  library: Library
  statuses: ServerStatus[]
  progress: ScanProgress
  query: string
  editingItemId: string | null
  versionPickerItemId: string | null
  /** Qué se está reproduciendo en el reproductor integrado. null = overlay cerrado. */
  playingTarget: PlayTarget | null
  downloads: DownloadEntry[]
  queue: QueueEntry[]
  toasts: Toast[]

  bootstrap: () => Promise<void>
  setQuery: (query: string) => void
  openEditor: (itemId: string | null) => void
  openVersionPicker: (itemId: string | null) => void
  openPlayer: (target: PlayTarget) => void
  closePlayer: () => void
  /** Reproduce en el externo saltándose el integrado (fallback por formato incompatible). */
  playExternal: (itemId: string, relPath?: string) => Promise<void>
  addToQueue: (itemId: string) => Promise<void>
  removeFromQueue: (itemId: string) => Promise<void>
  clearQueue: () => Promise<void>
  reloadConfig: () => Promise<void>
  reloadLibrary: () => Promise<void>
  pushToast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  play: (itemId: string, relPath?: string) => Promise<void>
  /** Si el item tiene ≥2 versiones abre el selector; si no, reproduce directo. */
  playSmart: (itemId: string) => void
  startDownload: (itemId: string, relPath?: string) => Promise<void>
  cancelDownload: (itemId: string, relPath: string) => Promise<void>
  deleteDownload: (itemId: string, relPath: string) => Promise<void>
}

const EMPTY_LIBRARY: Library = { version: 1, updatedAt: '', items: {} }
const IDLE_PROGRESS: ScanProgress = {
  phase: 'idle',
  current: 0,
  total: 0,
  label: '',
  running: false
}

let toastId = 0

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  library: EMPTY_LIBRARY,
  statuses: [],
  progress: IDLE_PROGRESS,
  query: '',
  editingItemId: null,
  versionPickerItemId: null,
  playingTarget: null,
  downloads: [],
  queue: [],
  toasts: [],

  bootstrap: async () => {
    const [config, library, statuses, progress, downloads, queue] = await Promise.all([
      window.api.getConfig(),
      window.api.getLibrary(),
      window.api.getServerStatuses(),
      window.api.getScanProgress(),
      window.api.getDownloads(),
      window.api.getQueue()
    ])
    set({ config, library, statuses, progress, downloads, queue })

    window.api.onLibraryChanged((next) => set({ library: next }))
    window.api.onScanProgress((next) => {
      set({ progress: next })
      // Al terminar un escaneo, refrescar el catálogo mostrado.
      if (!next.running && (next.phase === 'done' || next.phase === 'idle')) {
        void window.api.getLibrary().then((lib) => set({ library: lib }))
      }
    })
    window.api.onServerStatuses((next) => set({ statuses: next }))
    window.api.onDownloads((next) => set({ downloads: next }))
    window.api.onQueue((next) => set({ queue: next }))

    // Refresco periódico mientras corre el escaneo, para ver crecer el catálogo.
    setInterval(() => {
      if (get().progress.running) void window.api.getLibrary().then((lib) => set({ library: lib }))
    }, 4000)
  },

  setQuery: (query) => set({ query }),
  openEditor: (itemId) => set({ editingItemId: itemId }),
  openVersionPicker: (itemId) => set({ versionPickerItemId: itemId }),
  openPlayer: (target) => set({ playingTarget: target }),
  closePlayer: () => set({ playingTarget: null }),

  reloadConfig: async () => set({ config: await window.api.getConfig() }),
  reloadLibrary: async () => set({ library: await window.api.getLibrary() }),

  pushToast: (message, tone = 'info') => {
    const id = ++toastId
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 3500)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  // Único punto donde se decide integrado vs externo: las vistas solo llaman a play().
  play: async (itemId, relPath) => {
    if (get().config?.playbackMode === 'external') {
      await get().playExternal(itemId, relPath)
      return
    }
    get().openPlayer(relPath ? { itemId, relPath } : { itemId })
  },

  playExternal: async (itemId, relPath) => {
    const result = await window.api.play(itemId, relPath)
    if (!result.ok) get().pushToast(result.error ?? 'No se pudo reproducir el archivo.', 'error')
    else get().pushToast('Abriendo en el reproductor externo…')
  },

  playSmart: (itemId) => {
    const item = get().library.items[itemId]
    if (item?.kind === 'movie' && item.versions && item.versions.length >= 2) {
      get().openVersionPicker(itemId)
    } else {
      void get().play(itemId)
    }
  },

  addToQueue: async (itemId) => {
    const queue = await window.api.addToQueue(itemId)
    set({ queue })
    get().pushToast('Añadida a la cola.')
  },

  removeFromQueue: async (itemId) => {
    const queue = await window.api.removeFromQueue(itemId)
    set({ queue })
  },

  clearQueue: async () => {
    const queue = await window.api.clearQueue()
    set({ queue })
    get().pushToast('Cola vaciada.')
  },

  startDownload: async (itemId, relPath) => {
    const result = await window.api.startDownload(itemId, relPath)
    if (!result.ok) get().pushToast(result.error ?? 'No se pudo iniciar la descarga.', 'error')
    const downloads = await window.api.getDownloads()
    set({ downloads })
  },

  cancelDownload: async (itemId, relPath) => {
    await window.api.cancelDownload(itemId, relPath)
    set({ downloads: await window.api.getDownloads() })
  },

  deleteDownload: async (itemId, relPath) => {
    await window.api.deleteDownload(itemId, relPath)
    set({ downloads: await window.api.getDownloads() })
  }
}))

// ---------------------------------------------------------------------------
// Selectores derivados
// ---------------------------------------------------------------------------

export function visibleItems(library: Library): LibraryItem[] {
  return Object.values(library.items).filter((item) => !item.missing)
}

export function displayTitle(item: LibraryItem): string {
  return item.tmdb?.title || item.parsed.title
}

export function displayYear(item: LibraryItem): number | undefined {
  const fromTmdb = item.tmdb?.releaseDate ? Number(item.tmdb.releaseDate.slice(0, 4)) : undefined
  return Number.isFinite(fromTmdb) ? fromTmdb : item.parsed.year
}

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function sortByTitle(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), 'es'))
}

/** Entrada de descarga de un archivo concreto (versión o episodio), si existe. */
export function downloadFor(
  downloads: DownloadEntry[],
  itemId: string,
  relPath: string
): DownloadEntry | undefined {
  return downloads.find((entry) => entry.itemId === itemId && entry.relPath === relPath)
}

/** true si el item tiene AL MENOS un archivo (versión o episodio) descargado por completo. */
export function hasLocalCopy(downloads: DownloadEntry[], item: LibraryItem): boolean {
  const relPaths =
    item.kind === 'tv'
      ? (item.episodes ?? []).map((e) => e.relPath)
      : (item.versions ?? [{ videoRelPath: item.videoRelPath }]).map((v) => v.videoRelPath)
  return downloads.some(
    (entry) => entry.itemId === item.id && entry.state === 'done' && relPaths.includes(entry.relPath)
  )
}

export function inQueue(queue: QueueEntry[], itemId: string): boolean {
  return queue.some((entry) => entry.itemId === itemId)
}

/** Items de la cola en orden, resueltos contra la biblioteca y sin ausentes. */
export function queuedItems(library: Library, queue: QueueEntry[]): LibraryItem[] {
  const items: LibraryItem[] = []
  for (const entry of queue) {
    const item = library.items[entry.itemId]
    if (item && !item.missing) items.push(item)
  }
  return items
}

/** `"movie:603" -> itemId` para saber si un título "relacionado" ya está en el NAS. */
export function tmdbIndex(library: Library): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of Object.values(library.items)) {
    if (item.missing || !item.tmdb) continue
    map.set(`${item.tmdb.mediaType}:${item.tmdb.id}`, item.id)
  }
  return map
}
