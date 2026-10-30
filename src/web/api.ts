import { EVENTS, IPC } from '@shared/ipc-channels'
import type {
  AppCapabilities,
  DownloadEntry,
  IpcApi,
  Library,
  PlayTarget,
  QueueEntry,
  ScanProgress,
  ServerStatus
} from '@shared/types'
import { setMediaSrcResolver } from '@shared/media-src'
import { setTranscodeUrlBase, setVideoUrlResolver } from '@shared/playback-url'

// window.api del navegador (versión web): cada llamada es un POST al servidor LAN de la
// app de escritorio (src/main/web/lan-server.ts), que corre los MISMOS handlers de
// ipc.ts. Los eventos llegan por SSE. Video, transcode y portadas son rutas del mismo
// origen: sin CORS, sin crossOrigin en el <video>.

/** Cliente de la LAN: lo de la Mac (Finder, diálogos, descargas, ajustes) no aplica aquí. */
const WEB_CAPABILITIES: AppCapabilities = {
  platform: 'web',
  os: 'web',
  separateWindow: false,
  revealInFiles: false,
  chooseExternalPlayerFile: false,
  smbCredentials: false,
  mdnsDiscovery: false,
  externalPlayer: false,
  offlineDownloads: false,
  manageConfig: false,
  lanServer: false
}

const NOT_ON_WEB = 'No disponible en la versión web: hazlo desde la app de la Mac.'

async function rpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  // Sin undefined al final: JSON lo volvería null.
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop()
  const response = await fetch(`api/rpc/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  })
  const body = (await response.json().catch(() => ({}))) as { result?: T; error?: string }
  if (!response.ok) throw new Error(body.error ?? `Error ${response.status} del servidor`)
  return body.result as T
}

type Listener = (payload: never) => void
const listeners = new Map<string, Set<Listener>>()

function connectEvents(): void {
  // EventSource reconecta solo si la Mac se duerme o se cae la wifi.
  const source = new EventSource('api/events')
  source.onmessage = (message) => {
    const { channel, payload } = JSON.parse(message.data as string) as { channel: string; payload: never }
    for (const cb of [...(listeners.get(channel) ?? [])]) cb(payload)
  }
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  set.add(cb as Listener)
  return () => set.delete(cb as Listener)
}

export function installWebApi(): void {
  setVideoUrlResolver((itemId, relPath) => {
    const params = new URLSearchParams({ itemId })
    if (relPath) params.set('relPath', relPath)
    return `media/stream?${params.toString()}`
  })
  setTranscodeUrlBase('media/transcode')
  setMediaSrcResolver((cacheRelPath) => `media/cache/${cacheRelPath.split('/').map(encodeURIComponent).join('/')}`)

  const api: IpcApi = {
    capabilities: WEB_CAPABILITIES,

    getConfig: () => rpc(IPC.getConfig),
    saveConfig: (patch) => rpc(IPC.saveConfig, patch),
    testTmdbToken: async () => ({ ok: false, error: NOT_ON_WEB }),

    getLibrary: () => rpc(IPC.getLibrary),
    getServerStatuses: () => rpc(IPC.getServerStatuses),
    refreshServerStatuses: () => rpc(IPC.refreshServerStatuses),

    startScan: (opts) => rpc(IPC.startScan, opts),
    cancelScan: () => rpc(IPC.cancelScan),
    getScanProgress: () => rpc(IPC.getScanProgress),

    tmdbSearch: (query, year, kind) => rpc(IPC.tmdbSearch, query, year, kind),
    applyOverride: (itemId, override) => rpc(IPC.applyOverride, itemId, override),
    clearOverride: (itemId) => rpc(IPC.clearOverride, itemId),
    getTvDetails: (itemId) => rpc(IPC.getTvDetails, itemId),
    getExtraDetails: (itemId) => rpc(IPC.getExtraDetails, itemId),

    // El reproductor externo abriría el archivo en la Mac, no en este navegador.
    play: async () => ({ ok: false, error: 'Este formato no se puede reproducir en el navegador.' }),
    revealInFinder: async () => ({ ok: false, error: NOT_ON_WEB }),

    getChapterMarks: (itemId, relPath) => rpc(IPC.getChapterMarks, itemId, relPath),
    setIntroMark: (itemId, seconds) => rpc(IPC.setIntroMark, itemId, seconds),
    listSubtitleFiles: (itemId, relPath) => rpc(IPC.listSubtitleFiles, itemId, relPath),
    getSubtitleVtt: (itemId, relPath, source) => rpc(IPC.getSubtitleVtt, itemId, relPath, source),
    getPreviewFrame: (itemId, relPath, seconds) => rpc(IPC.getPreviewFrame, itemId, relPath, seconds),
    probeMedia: (itemId, relPath) => rpc(IPC.probeMedia, itemId, relPath),
    startTranscode: (options) => rpc(IPC.startTranscode, options),
    stopTranscode: (sessionId) => rpc(IPC.stopTranscode, sessionId),
    listExternalPlayers: async () => [],
    chooseExternalPlayer: async () => null,

    getQueue: () => rpc(IPC.getQueue),
    addToQueue: (itemId) => rpc(IPC.addToQueue, itemId),
    removeFromQueue: (itemId) => rpc(IPC.removeFromQueue, itemId),
    clearQueue: () => rpc(IPC.clearQueue),
    shiftQueue: (skipItemId) => rpc(IPC.shiftQueue, skipItemId),

    openPlayerWindow: async () => {},
    reattachPlayer: async () => {},
    consumePendingAttach: async () => null,

    discoverSmbServers: async () => [],
    purgeMissing: () => rpc(IPC.purgeMissing),

    startDownload: async () => ({ ok: false, error: NOT_ON_WEB }),
    cancelDownload: async () => {},
    deleteDownload: async () => {},
    getDownloads: async () => [],

    getPlaybackProgress: () => rpc(IPC.getPlaybackProgress),
    setPlaybackProgress: (entry) => rpc(IPC.setPlaybackProgress, entry),
    clearPlaybackProgress: (key) => rpc(IPC.clearPlaybackProgress, key),

    onScanProgress: (cb) => subscribe<ScanProgress>(EVENTS.scanProgress, cb),
    onLibraryChanged: (cb) => subscribe<Library>(EVENTS.libraryChanged, cb),
    onServerStatuses: (cb) => subscribe<ServerStatus[]>(EVENTS.serverStatuses, cb),
    onDownloads: (cb) => subscribe<DownloadEntry[]>(EVENTS.downloads, cb),
    onQueue: (cb) => subscribe<QueueEntry[]>(EVENTS.queue, cb),
    onPlayerAttach: (cb) => subscribe<PlayTarget>(EVENTS.playerAttach, cb)
  }

  window.api = api
  connectEvents()
}
