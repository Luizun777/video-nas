import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { EVENTS, IPC } from '@shared/ipc-channels'
import type {
  AppConfig,
  ChapterMarks,
  DownloadEntry,
  ExternalPlayerInfo,
  Library,
  LibraryItem,
  MediaKind,
  MetadataOverride,
  PlaybackProgressEntry,
  PlayResult,
  PlayTarget,
  QueueEntry,
  ScanProgress,
  ServerStatus,
  TmdbSearchResult
} from '@shared/types'
import { getConfig, saveConfig } from '@core/stores/config-store'
import { flushLibrary, getItem, getLibrary, putItem, removeItems } from '@core/stores/library-store'
import {
  clearOverride as clearOverrideEntry,
  flushOverrides,
  setOverride
} from '@core/stores/overrides-store'
import { clearProgress, getAllProgress, setProgress } from '@core/stores/progress-store'
import { discoverSmbServers } from './nas/discovery'
import { resolveAbsolutePath } from './playback/resolve'
import { readChapterMarks } from './playback/mkv-chapter-reader'
import { listExternalPlayers } from './playback/external-players'
import {
  closePlayerWindow,
  consumePendingAttach,
  findCatalogWindow,
  openPlayerWindow,
  setPendingAttach
} from './playback/player-window'
import { createMainWindow } from './main-window'
import {
  addToQueue,
  clearQueue,
  getQueue,
  removeFromQueue,
  shiftQueue
} from '@core/stores/queue-store'
import {
  cancelDownload,
  deleteDownload,
  getDownloads,
  onDownloadsChanged,
  startDownload
} from '@core/downloads/download-manager'
import {
  cancelScan,
  getProgress,
  getStatuses,
  onProgress,
  onStatuses,
  refreshStatuses,
  startScan
} from '@core/scanner/scan-orchestrator'
import { getExtraDetails as fetchExtraDetails, getTvSeasons, searchAsResults, testToken } from '@core/tmdb/client'
import { identifyByTmdbId } from '@core/tmdb/identifier'
import { desktopImageCache } from './tmdb/image-cache'

const exec = promisify(execFile)

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function emitLibrary(): void {
  broadcast(EVENTS.libraryChanged, getLibrary())
}


export function registerIpc(): void {
  // ---- Configuración -------------------------------------------------------
  ipcMain.handle(IPC.getConfig, (): AppConfig => getConfig())

  ipcMain.handle(IPC.saveConfig, async (_e, patch: Partial<AppConfig>): Promise<AppConfig> => {
    const config = saveConfig(patch)
    void refreshStatuses(false).then((statuses) => broadcast(EVENTS.serverStatuses, statuses))
    return config
  })

  ipcMain.handle(IPC.testTmdbToken, (_e, token: string) => testToken(token))

  // ---- Biblioteca ----------------------------------------------------------
  ipcMain.handle(IPC.getLibrary, (): Library => getLibrary())
  ipcMain.handle(IPC.getServerStatuses, (): ServerStatus[] => getStatuses())
  ipcMain.handle(IPC.refreshServerStatuses, (): Promise<ServerStatus[]> => refreshStatuses(true))

  ipcMain.handle(IPC.purgeMissing, async (): Promise<number> => {
    const missing = Object.values(getLibrary().items)
      .filter((item) => item.missing)
      .map((item) => item.id)
    const removed = removeItems(missing)
    await flushLibrary()
    emitLibrary()
    return removed
  })

  // ---- Escaneo -------------------------------------------------------------
  ipcMain.handle(IPC.startScan, async (_e, opts?: { full?: boolean }): Promise<void> => {
    void startScan(opts ?? {}).then(() => {
      emitLibrary()
    })
  })
  ipcMain.handle(IPC.cancelScan, (): void => cancelScan())
  ipcMain.handle(IPC.getScanProgress, (): ScanProgress => getProgress())

  // ---- TMDB ----------------------------------------------------------------
  ipcMain.handle(
    IPC.tmdbSearch,
    async (_e, query: string, year: number | undefined, kind: MediaKind): Promise<TmdbSearchResult[]> => {
      const config = getConfig()
      if (!config.tmdbBearerToken) return []
      try {
        return await searchAsResults(config.tmdbBearerToken, config.language, kind, query, year)
      } catch {
        return []
      }
    }
  )

  ipcMain.handle(
    IPC.applyOverride,
    async (_e, itemId: string, override: MetadataOverride): Promise<LibraryItem | null> => {
      const item = getItem(itemId)
      if (!item) return null
      setOverride(itemId, override)

      let updated: LibraryItem
      if (override.mode === 'file-only') {
        updated = { ...item, identify: 'file-only', tmdb: null, posterCache: undefined, backdropCache: undefined }
      } else {
        const config = getConfig()
        const outcome = await identifyByTmdbId(override.mediaType ?? item.kind, override.tmdbId!, {
          token: config.tmdbBearerToken,
          language: config.language,
          images: desktopImageCache
        })
        updated = { ...item, ...outcome, tvDetails: null, extraDetails: null }
      }

      putItem(updated)
      await Promise.all([flushLibrary(), flushOverrides()])
      emitLibrary()
      return updated
    }
  )

  ipcMain.handle(IPC.clearOverride, async (_e, itemId: string): Promise<LibraryItem | null> => {
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
  })

  ipcMain.handle(IPC.getTvDetails, async (_e, itemId: string): Promise<LibraryItem | null> => {
    const item = getItem(itemId)
    if (!item) return null
    if (item.kind !== 'tv' || !item.tmdb) return item
    if (item.tvDetails) return item

    const config = getConfig()
    if (!config.tmdbBearerToken) return item
    try {
      const details = await getTvSeasons(config.tmdbBearerToken, config.language, item.tmdb.id)
      const updated = { ...item, tvDetails: details }
      putItem(updated)
      await flushLibrary()
      return updated
    } catch {
      return item
    }
  })

  ipcMain.handle(IPC.getExtraDetails, async (_e, itemId: string): Promise<LibraryItem | null> => {
    const item = getItem(itemId)
    if (!item) return null
    if (!item.tmdb) return item
    if (item.extraDetails) return item

    const config = getConfig()
    if (!config.tmdbBearerToken) return item
    try {
      const extraDetails = await fetchExtraDetails(
        config.tmdbBearerToken,
        config.language,
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
  })

  // ---- Reproducción --------------------------------------------------------
  ipcMain.handle(IPC.play, async (_e, itemId: string, relPath?: string): Promise<PlayResult> => {
    const resolved = await resolveAbsolutePath(itemId, relPath)
    if ('error' in resolved) return { ok: false, error: resolved.error }

    // Con un reproductor concreto elegido se fuerza esa app; si no, el asociado del sistema.
    const { externalPlayerPath } = getConfig()
    if (externalPlayerPath) {
      try {
        await exec('/usr/bin/open', ['-a', externalPlayerPath, resolved.absPath])
        return { ok: true }
      } catch (error) {
        return { ok: false, error: `No se pudo abrir con ${externalPlayerPath}: ${(error as Error).message}` }
      }
    }

    const error = await shell.openPath(resolved.absPath)
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle(
    IPC.getChapterMarks,
    async (_e, itemId: string, relPath?: string): Promise<ChapterMarks> => {
      const resolved = await resolveAbsolutePath(itemId, relPath)
      if ('error' in resolved) return {}
      return readChapterMarks(resolved.absPath)
    }
  )

  ipcMain.handle(
    IPC.setIntroMark,
    async (_e, itemId: string, seconds: number): Promise<LibraryItem | null> => {
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
    }
  )

  ipcMain.handle(IPC.listExternalPlayers, (): ExternalPlayerInfo[] => listExternalPlayers())

  ipcMain.handle(IPC.chooseExternalPlayer, async (): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(window, {
      title: 'Elige un reproductor',
      defaultPath: '/Applications',
      properties: ['openFile'],
      filters: [{ name: 'Aplicaciones', extensions: ['app'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.revealInFinder, async (_e, itemId: string, relPath?: string): Promise<PlayResult> => {
    const resolved = await resolveAbsolutePath(itemId, relPath)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    shell.showItemInFolder(resolved.absPath)
    return { ok: true }
  })

  // ---- Cola de reproducción -----------------------------------------------
  const broadcastQueue = (): void => broadcast(EVENTS.queue, getQueue())

  ipcMain.handle(IPC.getQueue, (): QueueEntry[] => getQueue())
  ipcMain.handle(IPC.addToQueue, (_e, itemId: string): QueueEntry[] => {
    const entries = addToQueue(itemId)
    broadcastQueue()
    return entries
  })
  ipcMain.handle(IPC.removeFromQueue, (_e, itemId: string): QueueEntry[] => {
    const entries = removeFromQueue(itemId)
    broadcastQueue()
    return entries
  })
  ipcMain.handle(IPC.clearQueue, (): QueueEntry[] => {
    const entries = clearQueue()
    broadcastQueue()
    return entries
  })
  ipcMain.handle(IPC.shiftQueue, (_e, skipItemId?: string): QueueEntry | null => {
    const entry = shiftQueue(skipItemId)
    broadcastQueue()
    return entry
  })

  // ---- Ventana separada del reproductor ------------------------------------
  ipcMain.handle(IPC.openPlayerWindow, (_e, target: PlayTarget): void => {
    openPlayerWindow(target)
  })

  ipcMain.handle(IPC.reattachPlayer, (_e, target: PlayTarget): void => {
    const catalog = findCatalogWindow()
    if (catalog) {
      // Envío dirigido (no broadcast): la ventana del reproductor, que se está cerrando,
      // no debe recibir este evento.
      catalog.webContents.send(EVENTS.playerAttach, target)
      catalog.focus()
    } else {
      // La principal se cerró (posible en macOS): se recrea y el target queda pendiente
      // hasta que su renderer arranque y lo consuma.
      setPendingAttach(target)
      createMainWindow()
    }
    closePlayerWindow()
  })

  ipcMain.handle(IPC.consumePendingAttach, (): PlayTarget | null => consumePendingAttach())

  // ---- Red -----------------------------------------------------------------
  ipcMain.handle(IPC.discoverSmbServers, () => discoverSmbServers())

  // ---- Descargas (modo offline) --------------------------------------------
  ipcMain.handle(IPC.startDownload, (_e, itemId: string, relPath?: string): Promise<PlayResult> =>
    startDownload(itemId, relPath)
  )
  ipcMain.handle(IPC.cancelDownload, (_e, itemId: string, relPath: string): Promise<void> =>
    cancelDownload(itemId, relPath)
  )
  ipcMain.handle(IPC.deleteDownload, (_e, itemId: string, relPath: string): Promise<void> =>
    deleteDownload(itemId, relPath)
  )
  ipcMain.handle(IPC.getDownloads, (): DownloadEntry[] => getDownloads())

  // ---- Progreso de reproducción ("continuar viendo") -----------------------
  ipcMain.handle(IPC.getPlaybackProgress, (): PlaybackProgressEntry[] => getAllProgress())
  ipcMain.handle(
    IPC.setPlaybackProgress,
    (_e, entry: Omit<PlaybackProgressEntry, 'updatedAt' | 'finished'>): void => setProgress(entry)
  )
  ipcMain.handle(IPC.clearPlaybackProgress, (_e, key: string): void => clearProgress(key))

  // ---- Eventos hacia el renderer ------------------------------------------
  onProgress((progress) => broadcast(EVENTS.scanProgress, progress))
  onStatuses((statuses) => broadcast(EVENTS.serverStatuses, statuses))
  onDownloadsChanged((entries) => broadcast(EVENTS.downloads, entries))
}
