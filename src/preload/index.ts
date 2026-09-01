import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENTS, IPC } from '@shared/ipc-channels'
import type {
  AppCapabilities,
  AppConfig,
  ChapterMarks,
  DownloadEntry,
  ExternalPlayerInfo,
  IpcApi,
  MediaProbe,
  PlaybackPlan,
  PlaybackProgressEntry,
  PlayTarget,
  QueueEntry,
  SubtitleFileInfo,
  Library,
  LibraryItem,
  MediaKind,
  MetadataOverride,
  PlayResult,
  ScanProgress,
  ServerStatus,
  TmdbSearchResult,
  DiscoveredServer
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** El escritorio lo puede todo; smbCredentials va en false: el Llavero de macOS se encarga. */
const DESKTOP_CAPABILITIES: AppCapabilities = {
  platform: 'desktop',
  separateWindow: true,
  revealInFiles: true,
  chooseExternalPlayerFile: true,
  smbCredentials: false,
  mdnsDiscovery: true
}

const api: IpcApi = {
  capabilities: DESKTOP_CAPABILITIES,

  getConfig: () => ipcRenderer.invoke(IPC.getConfig) as Promise<AppConfig>,
  saveConfig: (patch) => ipcRenderer.invoke(IPC.saveConfig, patch) as Promise<AppConfig>,
  testTmdbToken: (token) =>
    ipcRenderer.invoke(IPC.testTmdbToken, token) as Promise<{ ok: boolean; error?: string }>,

  getLibrary: () => ipcRenderer.invoke(IPC.getLibrary) as Promise<Library>,
  getServerStatuses: () => ipcRenderer.invoke(IPC.getServerStatuses) as Promise<ServerStatus[]>,
  refreshServerStatuses: () =>
    ipcRenderer.invoke(IPC.refreshServerStatuses) as Promise<ServerStatus[]>,

  startScan: (opts) => ipcRenderer.invoke(IPC.startScan, opts) as Promise<void>,
  cancelScan: () => ipcRenderer.invoke(IPC.cancelScan) as Promise<void>,
  getScanProgress: () => ipcRenderer.invoke(IPC.getScanProgress) as Promise<ScanProgress>,

  tmdbSearch: (query: string, year: number | undefined, kind: MediaKind) =>
    ipcRenderer.invoke(IPC.tmdbSearch, query, year, kind) as Promise<TmdbSearchResult[]>,
  applyOverride: (itemId: string, override: MetadataOverride) =>
    ipcRenderer.invoke(IPC.applyOverride, itemId, override) as Promise<LibraryItem | null>,
  clearOverride: (itemId: string) =>
    ipcRenderer.invoke(IPC.clearOverride, itemId) as Promise<LibraryItem | null>,
  getTvDetails: (itemId: string) =>
    ipcRenderer.invoke(IPC.getTvDetails, itemId) as Promise<LibraryItem | null>,
  getExtraDetails: (itemId: string) =>
    ipcRenderer.invoke(IPC.getExtraDetails, itemId) as Promise<LibraryItem | null>,

  play: (itemId: string, relPath?: string) =>
    ipcRenderer.invoke(IPC.play, itemId, relPath) as Promise<PlayResult>,
  revealInFinder: (itemId: string, relPath?: string) =>
    ipcRenderer.invoke(IPC.revealInFinder, itemId, relPath) as Promise<PlayResult>,

  getChapterMarks: (itemId: string, relPath?: string) =>
    ipcRenderer.invoke(IPC.getChapterMarks, itemId, relPath) as Promise<ChapterMarks>,
  setIntroMark: (itemId: string, seconds: number) =>
    ipcRenderer.invoke(IPC.setIntroMark, itemId, seconds) as Promise<LibraryItem | null>,
  listExternalPlayers: () =>
    ipcRenderer.invoke(IPC.listExternalPlayers) as Promise<ExternalPlayerInfo[]>,
  chooseExternalPlayer: () =>
    ipcRenderer.invoke(IPC.chooseExternalPlayer) as Promise<string | null>,

  getQueue: () => ipcRenderer.invoke(IPC.getQueue) as Promise<QueueEntry[]>,
  addToQueue: (itemId: string) => ipcRenderer.invoke(IPC.addToQueue, itemId) as Promise<QueueEntry[]>,
  removeFromQueue: (itemId: string) =>
    ipcRenderer.invoke(IPC.removeFromQueue, itemId) as Promise<QueueEntry[]>,
  clearQueue: () => ipcRenderer.invoke(IPC.clearQueue) as Promise<QueueEntry[]>,
  shiftQueue: (skipItemId?: string) =>
    ipcRenderer.invoke(IPC.shiftQueue, skipItemId) as Promise<QueueEntry | null>,

  openPlayerWindow: (target: PlayTarget) =>
    ipcRenderer.invoke(IPC.openPlayerWindow, target) as Promise<void>,
  reattachPlayer: (target: PlayTarget) =>
    ipcRenderer.invoke(IPC.reattachPlayer, target) as Promise<void>,
  consumePendingAttach: () =>
    ipcRenderer.invoke(IPC.consumePendingAttach) as Promise<PlayTarget | null>,

  discoverSmbServers: () => ipcRenderer.invoke(IPC.discoverSmbServers) as Promise<DiscoveredServer[]>,
  purgeMissing: () => ipcRenderer.invoke(IPC.purgeMissing) as Promise<number>,

  startDownload: (itemId: string, relPath?: string) =>
    ipcRenderer.invoke(IPC.startDownload, itemId, relPath) as Promise<PlayResult>,
  cancelDownload: (itemId: string, relPath: string) =>
    ipcRenderer.invoke(IPC.cancelDownload, itemId, relPath) as Promise<void>,
  deleteDownload: (itemId: string, relPath: string) =>
    ipcRenderer.invoke(IPC.deleteDownload, itemId, relPath) as Promise<void>,
  getDownloads: () => ipcRenderer.invoke(IPC.getDownloads) as Promise<DownloadEntry[]>,

  getPlaybackProgress: () =>
    ipcRenderer.invoke(IPC.getPlaybackProgress) as Promise<PlaybackProgressEntry[]>,
  setPlaybackProgress: (entry) =>
    ipcRenderer.invoke(IPC.setPlaybackProgress, entry) as Promise<void>,
  clearPlaybackProgress: (key: string) =>
    ipcRenderer.invoke(IPC.clearPlaybackProgress, key) as Promise<void>,

  listSubtitleFiles: (itemId: string, relPath?: string) =>
    ipcRenderer.invoke(IPC.listSubtitleFiles, itemId, relPath) as Promise<SubtitleFileInfo[]>,
  getSubtitleVtt: (
    itemId: string,
    relPath: string | undefined,
    source: { stream: number } | { ext: string }
  ) => ipcRenderer.invoke(IPC.getSubtitleVtt, itemId, relPath, source) as Promise<string | null>,
  getPreviewFrame: (itemId: string, relPath: string | undefined, seconds: number) =>
    ipcRenderer.invoke(IPC.getPreviewFrame, itemId, relPath, seconds) as Promise<string | null>,
  probeMedia: (itemId: string, relPath?: string) =>
    ipcRenderer.invoke(IPC.probeMedia, itemId, relPath) as Promise<{
      probe: MediaProbe
      plan: PlaybackPlan
    } | null>,
  startTranscode: (options) =>
    ipcRenderer.invoke(IPC.startTranscode, options) as Promise<{ sessionId: string } | null>,
  stopTranscode: (sessionId: string) =>
    ipcRenderer.invoke(IPC.stopTranscode, sessionId) as Promise<void>,

  onScanProgress: (cb) => subscribe<ScanProgress>(EVENTS.scanProgress, cb),
  onLibraryChanged: (cb) => subscribe<Library>(EVENTS.libraryChanged, cb),
  onServerStatuses: (cb) => subscribe<ServerStatus[]>(EVENTS.serverStatuses, cb),
  onDownloads: (cb) => subscribe<DownloadEntry[]>(EVENTS.downloads, cb),
  onQueue: (cb) => subscribe<QueueEntry[]>(EVENTS.queue, cb),
  onPlayerAttach: (cb) => subscribe<PlayTarget>(EVENTS.playerAttach, cb)
}

contextBridge.exposeInMainWorld('api', api)
