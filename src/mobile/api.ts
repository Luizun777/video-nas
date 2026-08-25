import type {
  AppCapabilities,
  AppConfig,
  DownloadEntry,
  IpcApi,
  Library,
  LibraryItem,
  QueueEntry,
  ScanProgress,
  ServerStatus
} from '@shared/types'
import { enableTmdbDirectFallback, setMediaSrcResolver } from '@shared/media-src'
import type { ScanEnv } from '@core/io'
import { getConfig, initConfigStore, saveConfig } from '@core/stores/config-store'
import {
  flushLibrary,
  getItem,
  getLibrary,
  initLibraryStore,
  putItem,
  removeItems
} from '@core/stores/library-store'
import {
  clearOverride as clearOverrideEntry,
  flushOverrides,
  initOverridesStore,
  setOverride
} from '@core/stores/overrides-store'
import {
  addToQueue,
  clearQueue,
  getQueue,
  initQueueStore,
  removeFromQueue,
  shiftQueue
} from '@core/stores/queue-store'
import {
  clearProgress,
  getAllProgress,
  initProgressStore,
  setProgress
} from '@core/stores/progress-store'
import {
  cancelScan,
  getProgress,
  getStatuses,
  initScanner,
  onProgress,
  onStatuses,
  refreshStatuses,
  startScan
} from '@core/scanner/scan-orchestrator'
import {
  cancelDownload,
  deleteDownload,
  getDownloads,
  initDownloadManager,
  onDownloadsChanged,
  startDownload
} from '@core/downloads/download-manager'
import {
  getExtraDetails as fetchExtraDetails,
  getTvSeasons,
  searchAsResults,
  testToken
} from '@core/tmdb/client'
import { identifyByTmdbId } from '@core/tmdb/identifier'
import { Emitter } from './emitter'
import { Nas } from './nas-plugin'
import { capacitorStoreIO } from './adapters/capacitor-store-io'
import { createSmbFs } from './adapters/smb-fs-adapter'
import { capacitorImageCache, imageCacheBaseUrl } from './adapters/capacitor-image-cache'
import { capacitorDownloadTransfer } from './adapters/capacitor-download-transfer'
import { chapterMarksFor, initBridge, playExternalTarget } from './playback'

// El "proceso main" de Android: mismo contrato IpcApi que el preload de Electron, pero
// en el propio WebView. Cada handler es el espejo de su gemelo en src/main/ipc.ts.

const ANDROID_CAPABILITIES: AppCapabilities = {
  platform: 'android',
  separateWindow: false,
  pip: false,
  revealInFiles: false,
  chooseExternalPlayerFile: false,
  smbCredentials: true,
  mdnsDiscovery: false
}

async function configurePlugin(config: AppConfig): Promise<void> {
  await Nas.configure({
    servers: config.servers.map((server) => ({
      id: server.id,
      host: server.host,
      share: server.share,
      username: server.username,
      password: server.password,
      domain: server.domain
    }))
  })
}

/** ScanEnv de Android: probe SMB con credenciales en lugar de montaje por Llavero. */
const mobileScanEnv: ScanEnv = {
  async connect(server) {
    if (!server.enabled) return { status: { serverId: server.id, state: 'disabled' }, fs: null }
    try {
      const result = await Nas.probe({ serverId: server.id })
      if (result.state === 'online') {
        return { status: { serverId: server.id, state: 'online' }, fs: createSmbFs(server.id) }
      }
      const message =
        result.state === 'auth'
          ? (result.message ?? 'Usuario o contraseña SMB incorrectos. Revísalos en Ajustes.')
          : (result.message ?? `No se pudo contactar a ${server.host} en el puerto SMB (445).`)
      return { status: { serverId: server.id, state: 'offline', message }, fs: null }
    } catch (error) {
      return {
        status: { serverId: server.id, state: 'offline', message: (error as Error).message },
        fs: null
      }
    }
  },
  images: capacitorImageCache
}

export async function installMobileApi(): Promise<void> {
  const emitter = new Emitter<{
    scanProgress: ScanProgress
    libraryChanged: Library
    serverStatuses: ServerStatus[]
    downloads: DownloadEntry[]
    queue: QueueEntry[]
  }>()

  const config = await initConfigStore(capacitorStoreIO, {
    defaultDownloadsPath: (await Nas.localVideosDir()).path,
    // Sembrado en build desde seed.config.json (gitignored); editable en Ajustes.
    loadSeedToken: async () => __SEED_TMDB_TOKEN__
  })
  await Promise.all([
    initLibraryStore(capacitorStoreIO),
    initOverridesStore(capacitorStoreIO),
    initQueueStore(capacitorStoreIO),
    initProgressStore(capacitorStoreIO)
  ])

  await configurePlugin(config)
  initScanner(mobileScanEnv)
  await initDownloadManager(capacitorStoreIO, capacitorDownloadTransfer)
  await initBridge()

  const cacheBase = await imageCacheBaseUrl()
  setMediaSrcResolver((cacheRelPath) => `${cacheBase}/${cacheRelPath}`)
  enableTmdbDirectFallback()

  const emitLibrary = (): void => emitter.emit('libraryChanged', getLibrary())
  const broadcastQueue = (): void => emitter.emit('queue', getQueue())

  onProgress((progress) => {
    emitter.emit('scanProgress', progress)
    // El escaneo corre en el WebView: con la pantalla apagada Android lo pausaría.
    void Nas.keepScreenOn({ on: progress.running }).catch(() => {})
  })
  onStatuses((statuses) => emitter.emit('serverStatuses', statuses))
  onDownloadsChanged((entries) => emitter.emit('downloads', entries))

  const api: IpcApi = {
    capabilities: ANDROID_CAPABILITIES,

    getConfig: async () => getConfig(),
    saveConfig: async (patch) => {
      const next = saveConfig(patch)
      await configurePlugin(next)
      void refreshStatuses(false).then((statuses) => emitter.emit('serverStatuses', statuses))
      return next
    },
    testTmdbToken: (token) => testToken(token),

    getLibrary: async () => getLibrary(),
    getServerStatuses: async () => getStatuses(),
    refreshServerStatuses: () => refreshStatuses(true),

    purgeMissing: async () => {
      const missing = Object.values(getLibrary().items)
        .filter((item) => item.missing)
        .map((item) => item.id)
      const removed = removeItems(missing)
      await flushLibrary()
      emitLibrary()
      return removed
    },

    startScan: async (opts) => {
      void startScan(opts ?? {}).then(() => {
        emitLibrary()
      })
    },
    cancelScan: async () => cancelScan(),
    getScanProgress: async () => getProgress(),

    tmdbSearch: async (query, year, kind) => {
      const current = getConfig()
      if (!current.tmdbBearerToken) return []
      try {
        return await searchAsResults(current.tmdbBearerToken, current.language, kind, query, year)
      } catch {
        return []
      }
    },

    applyOverride: async (itemId, override) => {
      const item = getItem(itemId)
      if (!item) return null
      setOverride(itemId, override)

      let updated: LibraryItem
      if (override.mode === 'file-only') {
        updated = {
          ...item,
          identify: 'file-only',
          tmdb: null,
          posterCache: undefined,
          backdropCache: undefined
        }
      } else {
        const current = getConfig()
        const outcome = await identifyByTmdbId(override.mediaType ?? item.kind, override.tmdbId!, {
          token: current.tmdbBearerToken,
          language: current.language,
          images: capacitorImageCache
        })
        updated = { ...item, ...outcome, tvDetails: null, extraDetails: null }
      }

      putItem(updated)
      await Promise.all([flushLibrary(), flushOverrides()])
      emitLibrary()
      return updated
    },

    clearOverride: async (itemId) => {
      const item = getItem(itemId)
      if (!item) return null
      clearOverrideEntry(itemId)
      const reset: LibraryItem = {
        ...item,
        identify: 'unidentified',
        tmdb: null,
        tvDetails: null,
        extraDetails: null,
        posterCache: undefined,
        backdropCache: undefined
      }
      putItem(reset)
      await Promise.all([flushLibrary(), flushOverrides()])
      emitLibrary()
      return reset
    },

    getTvDetails: async (itemId) => {
      const item = getItem(itemId)
      if (!item) return null
      if (item.kind !== 'tv' || !item.tmdb) return item
      if (item.tvDetails) return item

      const current = getConfig()
      if (!current.tmdbBearerToken) return item
      try {
        const details = await getTvSeasons(current.tmdbBearerToken, current.language, item.tmdb.id)
        const updated = { ...item, tvDetails: details }
        putItem(updated)
        await flushLibrary()
        return updated
      } catch {
        return item
      }
    },

    getExtraDetails: async (itemId) => {
      const item = getItem(itemId)
      if (!item) return null
      if (!item.tmdb) return item
      if (item.extraDetails) return item

      const current = getConfig()
      if (!current.tmdbBearerToken) return item
      try {
        const extraDetails = await fetchExtraDetails(
          current.tmdbBearerToken,
          current.language,
          item.tmdb.mediaType,
          item.tmdb.id
        )
        const updated = { ...item, extraDetails }
        putItem(updated)
        await flushLibrary()
        return updated
      } catch {
        return item
      }
    },

    // "Reproducir externo": Intent a VLC/MX con la URL del puente local.
    play: (itemId, relPath) => playExternalTarget(itemId, relPath),
    revealInFinder: async () => ({ ok: false, error: 'No disponible en Android.' }),

    getChapterMarks: (itemId, relPath) => chapterMarksFor(itemId, relPath),

    setIntroMark: async (itemId, seconds) => {
      const item = getItem(itemId)
      if (!item) return null
      const updated: LibraryItem = {
        ...item,
        introMark: { seconds, setAt: new Date().toISOString() }
      }
      putItem(updated)
      await flushLibrary()
      emitLibrary()
      return updated
    },

    listExternalPlayers: async () => {
      const { apps } = await Nas.listVideoApps()
      return apps.map((app) => ({ name: app.label, path: app.packageName }))
    },
    chooseExternalPlayer: async () => null,

    getQueue: async () => getQueue(),
    addToQueue: async (itemId) => {
      const entries = addToQueue(itemId)
      broadcastQueue()
      return entries
    },
    removeFromQueue: async (itemId) => {
      const entries = removeFromQueue(itemId)
      broadcastQueue()
      return entries
    },
    clearQueue: async () => {
      const entries = clearQueue()
      broadcastQueue()
      return entries
    },
    shiftQueue: async (skipItemId) => {
      const entry = shiftQueue(skipItemId)
      broadcastQueue()
      return entry
    },

    // Sin ventanas separadas en Android: el overlay es el único reproductor.
    openPlayerWindow: async () => {},
    reattachPlayer: async () => {},
    consumePendingAttach: async () => null,

    discoverSmbServers: async () => [],

    startDownload: (itemId, relPath) => startDownload(itemId, relPath),
    cancelDownload: (itemId, relPath) => cancelDownload(itemId, relPath),
    deleteDownload: (itemId, relPath) => deleteDownload(itemId, relPath),
    getDownloads: async () => getDownloads(),

    getPlaybackProgress: async () => getAllProgress(),
    setPlaybackProgress: async (entry) => setProgress(entry),
    clearPlaybackProgress: async (key) => clearProgress(key),

    onScanProgress: (cb) => emitter.on('scanProgress', cb),
    onLibraryChanged: (cb) => emitter.on('libraryChanged', cb),
    onServerStatuses: (cb) => emitter.on('serverStatuses', cb),
    onDownloads: (cb) => emitter.on('downloads', cb),
    onQueue: (cb) => emitter.on('queue', cb),
    onPlayerAttach: () => () => {}
  }

  window.api = api

  // Igual que el arranque del desktop: estado de servidores y escaneo incremental.
  void refreshStatuses(false).then(() => {
    void startScan().then(() => emitLibrary())
  })
}
