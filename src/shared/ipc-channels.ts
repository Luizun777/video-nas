export const IPC = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  testTmdbToken: 'config:test-token',

  getLibrary: 'library:get',
  getServerStatuses: 'servers:status',
  refreshServerStatuses: 'servers:refresh',

  startScan: 'scan:start',
  cancelScan: 'scan:cancel',
  getScanProgress: 'scan:progress-get',

  tmdbSearch: 'tmdb:search',
  applyOverride: 'override:apply',
  clearOverride: 'override:clear',
  getTvDetails: 'tmdb:tv-details',
  getExtraDetails: 'tmdb:extra-details',

  play: 'media:play',
  revealInFinder: 'media:reveal',

  getChapterMarks: 'playback:chapter-marks',
  setIntroMark: 'playback:set-intro-mark',
  listExternalPlayers: 'playback:list-external-players',
  chooseExternalPlayer: 'playback:choose-external-player',

  getQueue: 'queue:get',
  addToQueue: 'queue:add',
  removeFromQueue: 'queue:remove',
  clearQueue: 'queue:clear',
  shiftQueue: 'queue:shift',

  openPlayerWindow: 'player-window:open',
  reattachPlayer: 'player-window:reattach',
  consumePendingAttach: 'player-window:consume-pending-attach',

  discoverSmbServers: 'servers:discover',
  purgeMissing: 'library:purge-missing',

  startDownload: 'downloads:start',
  cancelDownload: 'downloads:cancel',
  deleteDownload: 'downloads:delete',
  getDownloads: 'downloads:get',

  getPlaybackProgress: 'progress:get',
  setPlaybackProgress: 'progress:set',
  clearPlaybackProgress: 'progress:clear',

  listSubtitleFiles: 'playback:subtitle-files',
  probeMedia: 'playback:probe',
  startTranscode: 'transcode:start',
  stopTranscode: 'transcode:stop'
} as const

export const EVENTS = {
  scanProgress: 'evt:scan-progress',
  libraryChanged: 'evt:library-changed',
  serverStatuses: 'evt:server-statuses',
  downloads: 'evt:downloads',
  queue: 'evt:queue',
  playerAttach: 'evt:player-attach'
} as const
