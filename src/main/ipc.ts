import { promises as nodeFs } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
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
import { clearProgress, getAllProgress, setProgress } from '@core/stores/progress-store'
import {
  applyOverrideToItem,
  clearOverrideToAuto,
  initOverrideService
} from '@core/metadata/override-service'
import { trySyncServer } from '@core/metadata/shared-overrides-sync'
import { discoverSmbServers } from './nas/discovery'
import { resolveAbsolutePath } from './playback/resolve'
import { readChapterMarks } from './playback/mkv-chapter-reader'
import { listExternalPlayers, openWithPlayer } from './playback/external-players'
import { previewFrame, probeMedia } from './playback/ffmpeg'
import { startTranscodeSession, stopTranscodeSession } from './playback/transcode-session'
import { decidePlaybackPlan } from '@core/playback/media-probe'
import { findSubtitleCandidates } from '@core/playback/subtitle-candidates'
import { convertSubtitleFile, extractEmbeddedSubtitle } from './playback/subtitle-extractor'
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
import { desktopImageCache } from './tmdb/image-cache'

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function emitLibrary(): void {
  broadcast(EVENTS.libraryChanged, getLibrary())
}


export function registerIpc(): void {
  initOverrideService({
    images: desktopImageCache,
    emitLibrary,
    onOverrideChanged: trySyncServer
  })

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

  // La lógica vive en core (override-service): la MISMA para Electron y Android.
  ipcMain.handle(
    IPC.applyOverride,
    (_e, itemId: string, override: MetadataOverride): Promise<LibraryItem | null> =>
      applyOverrideToItem(itemId, override)
  )

  ipcMain.handle(
    IPC.clearOverride,
    (_e, itemId: string): Promise<LibraryItem | null> => clearOverrideToAuto(itemId)
  )

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
        await openWithPlayer(externalPlayerPath, resolved.absPath)
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
    const onWindows = process.platform === 'win32'
    const result = await dialog.showOpenDialog(window, {
      title: 'Elige un reproductor',
      defaultPath: onWindows ? (process.env['ProgramFiles'] ?? 'C:\\Program Files') : '/Applications',
      properties: ['openFile'],
      filters: [
        onWindows ? { name: 'Programas', extensions: ['exe'] } : { name: 'Aplicaciones', extensions: ['app'] }
      ]
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

  // ---- Pistas, subtítulos y transcode (solo desktop) -----------------------
  ipcMain.handle(IPC.probeMedia, async (_e, itemId: string, relPath?: string) => {
    const resolved = await resolveAbsolutePath(itemId, relPath)
    if ('error' in resolved) return null
    try {
      const probe = await probeMedia(resolved.absPath)
      return { probe, plan: decidePlaybackPlan(probe) }
    } catch {
      // Sin ffprobe (o archivo raro) se reproduce directo, como antes de F14.
      return null
    }
  })

  ipcMain.handle(IPC.listSubtitleFiles, async (_e, itemId: string, relPath?: string) => {
    const item = getItem(itemId)
    if (!item) return []
    const resolved = await resolveAbsolutePath(itemId, relPath)
    if ('error' in resolved) return []

    const videoDir = dirname(resolved.absPath)
    const videoFileName = basename(resolved.absPath)
    const entries = await nodeFs.readdir(videoDir, { withFileTypes: true }).catch(() => [])
    const subsDirEntries: { dir: string; names: string[] }[] = []
    for (const entry of entries) {
      if (entry.isDirectory() && /^(subs|subtitles|subtitulos)$/i.test(entry.name)) {
        const inner = await nodeFs.readdir(join(videoDir, entry.name), { withFileTypes: true }).catch(() => [])
        subsDirEntries.push({
          dir: entry.name,
          names: inner.filter((e) => e.isFile()).map((e) => e.name)
        })
      }
    }

    // Sin url: en desktop el contenido se pide por IPC (getSubtitleVtt).
    return findSubtitleCandidates({
      videoFileName,
      dirEntries: entries.filter((e) => e.isFile()).map((e) => e.name),
      subsDirEntries
    })
  })

  // El VTT viaja como texto por IPC y el renderer lo monta con blob:. Servirlo por
  // videofile:// obligaría a marcar el <video> con crossOrigin, y eso rompe TODA la
  // reproducción (el esquema no tiene corsEnabled).
  ipcMain.handle(
    IPC.getSubtitleVtt,
    async (
      _e,
      itemId: string,
      relPath: string | undefined,
      source: { stream: number } | { ext: string }
    ): Promise<string | null> => {
      const resolved = await resolveAbsolutePath(itemId, relPath)
      if ('error' in resolved) return null
      if ('stream' in source) return extractEmbeddedSubtitle(resolved.absPath, source.stream)

      const videoDir = dirname(resolved.absPath)
      const subPath = normalize(join(videoDir, source.ext))
      if (!subPath.startsWith(videoDir)) return null
      return convertSubtitleFile(subPath)
    }
  )

  ipcMain.handle(
    IPC.getPreviewFrame,
    async (_e, itemId: string, relPath: string | undefined, seconds: number): Promise<string | null> => {
      const resolved = await resolveAbsolutePath(itemId, relPath)
      if ('error' in resolved) return null
      return previewFrame(resolved.absPath, seconds)
    }
  )

  ipcMain.handle(
    IPC.startTranscode,
    async (
      _e,
      options: {
        itemId: string
        relPath?: string
        startAt: number
        audioStreamIndex?: number
        videoCopy: boolean
      }
    ) => {
      const resolved = await resolveAbsolutePath(options.itemId, options.relPath)
      if ('error' in resolved) return null
      return startTranscodeSession({
        absPath: resolved.absPath,
        startAt: options.startAt,
        audioStreamIndex: options.audioStreamIndex,
        videoCopy: options.videoCopy
      })
    }
  )

  ipcMain.handle(IPC.stopTranscode, (_e, sessionId: string): void => {
    stopTranscodeSession(sessionId)
  })

  // ---- Eventos hacia el renderer ------------------------------------------
  onProgress((progress) => broadcast(EVENTS.scanProgress, progress))
  onStatuses((statuses) => broadcast(EVENTS.serverStatuses, statuses))
  onDownloadsChanged((entries) => broadcast(EVENTS.downloads, entries))
}
