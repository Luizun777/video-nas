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
import { initOverridesStore } from '@core/stores/overrides-store'
import {
  applyOverrideToItem,
  clearOverrideToAuto,
  initOverrideService
} from '@core/metadata/override-service'
import { initSharedOverridesSync, trySyncServer } from '@core/metadata/shared-overrides-sync'
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
import { Emitter } from './emitter'
import { Nas } from './nas-plugin'
import { capacitorStoreIO } from './adapters/capacitor-store-io'
import { createSmbFs } from './adapters/smb-fs-adapter'
import { capacitorImageCache, imageCacheBaseUrl } from './adapters/capacitor-image-cache'
import { capacitorDownloadTransfer } from './adapters/capacitor-download-transfer'
import {
  bridgeFileUrl,
  chapterMarksFor,
  initBridge,
  playExternalTarget,
  resolveStreamUrl
} from './playback'
import { pickTargetRelPath } from '@core/playback/resolve-target'
import { findSubtitleCandidates } from '@core/playback/subtitle-candidates'
import { registerEngineFactory } from '@/player/engine-registry'
import { VlcNativeEngine } from './vlc-engine'

// El "proceso main" de Android: mismo contrato IpcApi que el preload de Electron, pero
// en el propio WebView. Cada handler es el espejo de su gemelo en src/main/ipc.ts.

const ANDROID_CAPABILITIES: AppCapabilities = {
  platform: 'android',
  separateWindow: false,
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
  initSharedOverridesSync(mobileScanEnv)
  await initDownloadManager(capacitorStoreIO, capacitorDownloadTransfer)
  await initBridge()

  // Android reproduce SIEMPRE con libVLC embebido: decodifica lo que el WebView no
  // (AC3/DTS, HEVC 10-bit, DivX) y hace innecesario el watchdog y el fallback
  // automático a VLC externo (que sigue disponible como acción manual).
  registerEngineFactory(() => new VlcNativeEngine())

  const cacheBase = await imageCacheBaseUrl()
  setMediaSrcResolver((cacheRelPath) => `${cacheBase}/${cacheRelPath}`)
  enableTmdbDirectFallback()

  // En Electron cada respuesta cruza IPC y llega como objeto NUEVO; aquí main y
  // renderer comparten proceso y los stores mutan in place, así que sin estos
  // snapshots zustand ve la misma referencia y React no re-renderiza jamás.
  const snapshotLibrary = (): Library => ({ ...getLibrary() })
  const snapshotConfig = (): AppConfig => ({ ...getConfig() })
  const snapshotQueue = (): QueueEntry[] => [...getQueue()]

  const emitLibrary = (): void => emitter.emit('libraryChanged', snapshotLibrary())
  const broadcastQueue = (): void => emitter.emit('queue', snapshotQueue())

  initOverrideService({
    images: capacitorImageCache,
    emitLibrary,
    onOverrideChanged: trySyncServer
  })

  onProgress((progress) => {
    emitter.emit('scanProgress', progress)
    // El escaneo corre en el WebView: con la pantalla apagada Android lo pausaría.
    void Nas.keepScreenOn({ on: progress.running }).catch(() => {})
  })
  onStatuses((statuses) => emitter.emit('serverStatuses', statuses))
  onDownloadsChanged((entries) => emitter.emit('downloads', entries))

  const api: IpcApi = {
    capabilities: ANDROID_CAPABILITIES,

    getConfig: async () => snapshotConfig(),
    saveConfig: async (patch) => {
      const next = saveConfig(patch)
      await configurePlugin(next)
      void refreshStatuses(false).then((statuses) => emitter.emit('serverStatuses', statuses))
      return { ...next }
    },
    testTmdbToken: (token) => testToken(token),

    getLibrary: async () => snapshotLibrary(),
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

    // La lógica vive en core (override-service): la MISMA para Electron y Android.
    applyOverride: (itemId, override) => applyOverrideToItem(itemId, override),
    clearOverride: (itemId) => clearOverrideToAuto(itemId),

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

    getPreviewFrame: async (itemId, relPath, seconds) => {
      const url = resolveStreamUrl(itemId, relPath)
      if (url === 'about:blank') return null
      try {
        const { data } = await Nas.previewFrame({ url, timeMs: seconds * 1000 })
        return data ? `data:image/jpeg;base64,${data}` : null
      } catch {
        return null
      }
    },

    // Subtítulos externos junto al video (o en Subs/): se listan al reproducir, con
    // URLs del puente para que libVLC los cargue como slaves.
    listSubtitleFiles: async (itemId, relPath) => {
      const item = getItem(itemId)
      if (!item) return []
      const target = pickTargetRelPath(item, relPath)
      const slash = target.lastIndexOf('/')
      const dir = slash >= 0 ? target.slice(0, slash) : ''
      const videoFileName = slash >= 0 ? target.slice(slash + 1) : target
      try {
        const { entries } = await Nas.listDir({ serverId: item.serverId, path: dir })
        const subsDirEntries: { dir: string; names: string[] }[] = []
        for (const entry of entries) {
          if (entry.dir && /^(subs|subtitles|subtitulos)$/i.test(entry.name)) {
            const inner = await Nas.listDir({
              serverId: item.serverId,
              path: dir ? `${dir}/${entry.name}` : entry.name
            })
            subsDirEntries.push({
              dir: entry.name,
              names: inner.entries.filter((e) => !e.dir).map((e) => e.name)
            })
          }
        }
        const candidates = findSubtitleCandidates({
          videoFileName,
          dirEntries: entries.filter((e) => !e.dir).map((e) => e.name),
          subsDirEntries
        })
        const result = []
        for (const candidate of candidates) {
          const fullRelPath = dir ? `${dir}/${candidate.relPath}` : candidate.relPath
          const url = bridgeFileUrl(item.serverId, fullRelPath)
          if (url) result.push({ ...candidate, relPath: fullRelPath, url })
        }
        return result
      } catch {
        return [] // NAS offline (copia local): sin subtítulos externos no pasa nada.
      }
    },

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

    getQueue: async () => snapshotQueue(),
    addToQueue: async (itemId) => {
      addToQueue(itemId)
      broadcastQueue()
      return snapshotQueue()
    },
    removeFromQueue: async (itemId) => {
      removeFromQueue(itemId)
      broadcastQueue()
      return snapshotQueue()
    },
    clearQueue: async () => {
      clearQueue()
      broadcastQueue()
      return snapshotQueue()
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
