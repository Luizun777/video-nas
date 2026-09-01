import type {
  AppConfig,
  DownloadEntry,
  IpcApi,
  Library,
  LibraryItem,
  PlaybackProgressEntry,
  QueueEntry,
  ScanProgress,
  ServerStatus
} from '@shared/types'
import { setMediaSrcResolver } from '@shared/media-src'
import { setVideoUrlResolver } from '@shared/playback-url'
import { deepClone } from '@core/util'
import { Emitter } from './emitter'

// window.api de mentira para el preview de desarrollo en un navegador de escritorio:
// permite iterar la UI móvil (responsive, touch, gates de capabilities) sin tablet ni
// NAS. Nunca entra al APK: solo se importa bajo import.meta.env.DEV.

const SERVER_ID = 'srv_mock'
const now = new Date().toISOString()

function movie(
  relPath: string,
  title: string,
  year: number,
  extras: Partial<LibraryItem> = {}
): LibraryItem {
  const slug = relPath.replace(/\W+/g, '-').toLowerCase()
  return {
    id: `${SERVER_ID}:${relPath}`,
    serverId: SERVER_ID,
    relPath,
    kind: 'movie',
    parsed: { title, year },
    videoRelPath: `${relPath}/${title}.mkv`,
    primarySize: 8 * 1024 ** 3,
    identify: 'auto',
    tmdb: {
      id: Math.abs(hash(slug)),
      mediaType: 'movie',
      title,
      originalTitle: title,
      overview: `Sinopsis de prueba de "${title}" para el preview de desarrollo. Aquí iría el texto real de TheMovieDB en es-MX.`,
      posterPath: null,
      backdropPath: null,
      releaseDate: `${year}-01-01`,
      voteAverage: 7.4,
      genreIds: [28, 878],
      matchedAt: now
    },
    posterCache: `posters/${slug}`,
    backdropCache: `backdrops/${slug}`,
    firstSeenAt: now,
    lastSeenAt: now,
    ...extras
  }
}

function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0
  return value
}

function buildLibrary(): Library {
  const frieren: LibraryItem = {
    id: `${SERVER_ID}:TvShow/Frieren`,
    serverId: SERVER_ID,
    relPath: 'TvShow/Frieren',
    kind: 'tv',
    parsed: { title: 'Frieren' },
    episodes: Array.from({ length: 8 }, (_, i) => ({
      season: i < 5 ? 1 : 2,
      episode: (i % 5) + 1,
      relPath: `TvShow/Frieren/T${i < 5 ? 1 : 2}/E0${(i % 5) + 1}.mkv`
    })),
    tvDetails: {
      seasons: [
        { season: 1, name: 'Temporada 1', episodeNames: { 1: 'El final del viaje', 2: 'No hacía falta ser magia' } },
        { season: 2, name: 'Temporada 2', episodeNames: { 1: 'El mago de la clase' } }
      ],
      fetchedAt: now
    },
    identify: 'auto',
    tmdb: {
      id: 209867,
      mediaType: 'tv',
      title: 'Frieren: Más allá del final del viaje',
      originalTitle: '葬送のフリーレン',
      overview: 'La maga elfa Frieren emprende un nuevo viaje para entender a la humanidad.',
      posterPath: null,
      backdropPath: null,
      releaseDate: '2023-09-29',
      voteAverage: 8.8,
      genreIds: [16, 10765],
      matchedAt: now
    },
    posterCache: 'posters/frieren',
    backdropCache: 'backdrops/frieren',
    introMark: { seconds: 90, setAt: now },
    firstSeenAt: now,
    lastSeenAt: now
  }

  const items: LibraryItem[] = [
    movie('Movies/Avatar (2009)', 'Avatar', 2009, {
      versions: [
        { label: '4K BluRay x265 · MKV · 15.3 GB', videoRelPath: 'Movies/Avatar (2009)/Avatar.4k.mkv', size: 15.3 * 1024 ** 3 },
        { label: '1080p Extendida · MKV · 8.1 GB', videoRelPath: 'Movies/Avatar (2009)/Avatar.ext.mkv', size: 8.1 * 1024 ** 3 }
      ]
    }),
    movie('Movies/Interstellar (2014)', 'Interstellar', 2014),
    movie('Movies/1917 (2019)', '1917', 2019),
    movie('Movies/Coco (2017)', 'Coco', 2017, { tmdb: null, identify: 'unidentified', posterCache: undefined, backdropCache: undefined, parsed: { title: 'Coco 2017 1080P-Dual-Lat' } }),
    movie('Movies/Los Años Maravillsos', 'Los Años Maravillsos', 1988, { tmdb: null, identify: 'file-only', posterCache: undefined, backdropCache: undefined }),
    movie('Movies/El Viejo (1990)', 'El Viejo', 1990, { missing: true }),
    frieren,
    {
      ...movie('TvShow/Big Bang Theory', 'The Big Bang Theory', 2007),
      kind: 'tv',
      videoRelPath: undefined,
      episodes: [
        { season: 1, episode: 1, relPath: 'TvShow/Big Bang Theory/TBBT1/E01.mkv' },
        { season: 1, episode: 2, relPath: 'TvShow/Big Bang Theory/TBBT1/E02.mkv' }
      ]
    }
  ]

  const map: Record<string, LibraryItem> = {}
  for (const item of items) map[item.id] = item
  return { version: 1, updatedAt: now, items: map }
}

export function installMockApi(): void {
  const emitter = new Emitter<{
    scanProgress: ScanProgress
    libraryChanged: Library
    serverStatuses: ServerStatus[]
    downloads: DownloadEntry[]
    queue: QueueEntry[]
  }>()

  let library = buildLibrary()
  const firstMovieId = `${SERVER_ID}:Movies/Interstellar (2014)`

  let config: AppConfig = {
    version: 1,
    tmdbBearerToken: 'token-mock',
    language: 'es-MX',
    servers: [
      {
        id: SERVER_ID,
        name: 'NAS principal',
        host: '192.168.0.189',
        share: 'video',
        username: 'luizun',
        password: '',
        folders: [
          { path: 'Movies', kind: 'movie' },
          { path: 'TvShow', kind: 'tv' }
        ],
        enabled: true
      }
    ],
    downloadsPath: '/data/app/com.luizun.videonas/files/Movies',
    playbackMode: 'embedded',
    externalPlayerPath: null,
    autoPlayNextEpisode: true,
    autoSkipIntro: true
  }

  let statuses: ServerStatus[] = [{ serverId: SERVER_ID, state: 'online' }]
  let progress: ScanProgress = { phase: 'idle', current: 0, total: 0, label: '', running: false }
  let queue: QueueEntry[] = [{ itemId: firstMovieId, addedAt: now }]
  let downloads: DownloadEntry[] = [
    {
      key: `${SERVER_ID}:Movies/1917 (2019)::Movies/1917 (2019)/1917.mkv`,
      itemId: `${SERVER_ID}:Movies/1917 (2019)`,
      relPath: 'Movies/1917 (2019)/1917.mkv',
      localPath: '/data/mock/1917.mkv',
      totalBytes: 4 * 1024 ** 3,
      bytesDone: 4 * 1024 ** 3,
      state: 'done',
      startedAt: now,
      finishedAt: now
    }
  ]
  const progressEntries = new Map<string, PlaybackProgressEntry>()

  // Imágenes bonitas y deterministas sin depender de TMDB en el mock.
  setMediaSrcResolver((rel) => {
    const seed = encodeURIComponent(rel.replace(/\W+/g, '-'))
    return rel.startsWith('backdrops/')
      ? `https://picsum.photos/seed/${seed}/1280/720`
      : `https://picsum.photos/seed/${seed}/342/513`
  })
  // Un MP4 de muestra: suficiente para probar los controles táctiles del player.
  setVideoUrlResolver(() => 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4')

  const emitLibrary = (): void => emitter.emit('libraryChanged', deepClone(library))

  const putItem = (item: LibraryItem): LibraryItem => {
    library = { ...library, updatedAt: new Date().toISOString(), items: { ...library.items, [item.id]: item } }
    emitLibrary()
    return item
  }

  const api: IpcApi = {
    capabilities: {
      platform: 'android',
      separateWindow: false,
      revealInFiles: false,
      chooseExternalPlayerFile: false,
      smbCredentials: true,
      mdnsDiscovery: false
    },

    getConfig: async () => deepClone(config),
    saveConfig: async (patch) => {
      config = { ...config, ...patch, servers: patch.servers ?? config.servers } as AppConfig
      return deepClone(config)
    },
    testTmdbToken: async (token) =>
      token.trim().length > 10 ? { ok: true } : { ok: false, error: 'Token de prueba demasiado corto.' },

    getLibrary: async () => deepClone(library),
    getServerStatuses: async () => statuses,
    refreshServerStatuses: async () => {
      emitter.emit('serverStatuses', statuses)
      return statuses
    },

    startScan: async () => {
      let step = 0
      progress = { phase: 'walking', current: 0, total: 0, label: 'Explorando Movies…', running: true }
      emitter.emit('scanProgress', progress)
      const timer = setInterval(() => {
        step++
        if (step >= 6) {
          clearInterval(timer)
          progress = { phase: 'done', current: 8, total: 8, label: 'Biblioteca actualizada.', running: false }
        } else {
          progress = {
            phase: 'identifying',
            serverId: SERVER_ID,
            serverName: 'NAS principal',
            current: step,
            total: 6,
            label: `Identificando: título de prueba ${step}`,
            running: true
          }
        }
        emitter.emit('scanProgress', progress)
        if (!progress.running) emitLibrary()
      }, 700)
    },
    cancelScan: async () => {
      progress = { phase: 'idle', current: 0, total: 0, label: 'Escaneo cancelado.', running: false }
      emitter.emit('scanProgress', progress)
    },
    getScanProgress: async () => progress,

    tmdbSearch: async (query, year, kind) => [
      { id: 1, mediaType: kind, title: `${query} (resultado 1)`, originalTitle: query, overview: 'Resultado de prueba.', year: year ?? 2020, posterUrl: null, voteAverage: 7.1 },
      { id: 2, mediaType: kind, title: `${query} (resultado 2)`, originalTitle: query, overview: 'Otro resultado.', year: null, posterUrl: null, voteAverage: 5.9 }
    ],
    applyOverride: async (itemId, override) => {
      const item = library.items[itemId]
      if (!item) return null
      if (override.mode === 'file-only') {
        return putItem({ ...item, identify: 'file-only', tmdb: null, posterCache: undefined, backdropCache: undefined })
      }
      return putItem({
        ...item,
        identify: 'manual',
        tmdb: { ...(item.tmdb ?? buildLibrary().items[firstMovieId].tmdb!), id: override.tmdbId ?? 999, title: `${item.parsed.title} (corregido)` }
      })
    },
    clearOverride: async (itemId) => {
      const item = library.items[itemId]
      if (!item) return null
      return putItem({ ...item, identify: 'unidentified', tmdb: null, posterCache: undefined, backdropCache: undefined })
    },
    getTvDetails: async (itemId) => library.items[itemId] ?? null,
    getExtraDetails: async (itemId) => {
      const item = library.items[itemId]
      if (!item?.tmdb) return item ?? null
      if (item.extraDetails) return item
      return putItem({
        ...item,
        extraDetails: {
          cast: [
            { id: 1, name: 'Actriz De Prueba', character: 'Protagonista', profilePath: null },
            { id: 2, name: 'Actor De Prueba', character: 'Secundario', profilePath: null }
          ],
          directors: ['Dirección De Prueba'],
          related: [
            { id: 42, mediaType: item.kind, title: 'Título relacionado', year: 2021, posterPath: null }
          ],
          fetchedAt: new Date().toISOString()
        }
      })
    },

    play: async () => ({ ok: true }),
    revealInFinder: async () => ({ ok: false, error: 'No disponible en el mock.' }),

    getChapterMarks: async () => ({ introEndSeconds: 3, outroStartSeconds: undefined }),
    setIntroMark: async (itemId, seconds) => {
      const item = library.items[itemId]
      if (!item) return null
      return putItem({ ...item, introMark: { seconds, setAt: new Date().toISOString() } })
    },
    listExternalPlayers: async () => [
      { name: 'VLC', path: 'org.videolan.vlc' },
      { name: 'MX Player', path: 'com.mxtech.videoplayer.ad' }
    ],
    chooseExternalPlayer: async () => null,

    getQueue: async () => queue,
    addToQueue: async (itemId) => {
      if (!queue.some((entry) => entry.itemId === itemId)) {
        queue = [...queue, { itemId, addedAt: new Date().toISOString() }]
      }
      emitter.emit('queue', queue)
      return queue
    },
    removeFromQueue: async (itemId) => {
      queue = queue.filter((entry) => entry.itemId !== itemId)
      emitter.emit('queue', queue)
      return queue
    },
    clearQueue: async () => {
      queue = []
      emitter.emit('queue', queue)
      return queue
    },
    shiftQueue: async (skipItemId) => {
      while (queue.length > 0) {
        const head = queue[0]
        queue = queue.slice(1)
        emitter.emit('queue', queue)
        if (head.itemId === skipItemId) continue
        const item = library.items[head.itemId]
        if (!item || item.missing) continue
        return head
      }
      emitter.emit('queue', queue)
      return null
    },

    openPlayerWindow: async () => {},
    reattachPlayer: async () => {},
    consumePendingAttach: async () => null,

    discoverSmbServers: async () => [],
    purgeMissing: async () => {
      const missing = Object.values(library.items).filter((item) => item.missing)
      const items = { ...library.items }
      for (const item of missing) delete items[item.id]
      library = { ...library, items }
      emitLibrary()
      return missing.length
    },

    startDownload: async (itemId, relPath) => {
      const item = library.items[itemId]
      if (!item) return { ok: false, error: 'No existe en el mock.' }
      const target = relPath ?? item.videoRelPath ?? item.episodes?.[0]?.relPath ?? item.relPath
      const key = `${itemId}::${target}`
      if (downloads.some((d) => d.key === key)) return { ok: true }
      const entry: DownloadEntry = {
        key,
        itemId,
        relPath: target,
        localPath: `/data/mock/${target}`,
        totalBytes: 2 * 1024 ** 3,
        bytesDone: 0,
        state: 'downloading',
        startedAt: new Date().toISOString()
      }
      downloads = [...downloads, entry]
      emitter.emit('downloads', downloads)
      const timer = setInterval(() => {
        const current = downloads.find((d) => d.key === key)
        if (!current || current.state !== 'downloading') return void clearInterval(timer)
        const bytesDone = Math.min(current.totalBytes, current.bytesDone + current.totalBytes / 5)
        const done = bytesDone >= current.totalBytes
        downloads = downloads.map((d) =>
          d.key === key
            ? { ...d, bytesDone, state: done ? 'done' : 'downloading', finishedAt: done ? new Date().toISOString() : undefined }
            : d
        )
        emitter.emit('downloads', downloads)
        if (done) clearInterval(timer)
      }, 800)
      return { ok: true }
    },
    cancelDownload: async (itemId, relPath) => {
      downloads = downloads.filter((d) => d.key !== `${itemId}::${relPath}`)
      emitter.emit('downloads', downloads)
    },
    deleteDownload: async (itemId, relPath) => {
      downloads = downloads.filter((d) => d.key !== `${itemId}::${relPath}`)
      emitter.emit('downloads', downloads)
    },
    getDownloads: async () => downloads,

    getPlaybackProgress: async () => [...progressEntries.values()],
    setPlaybackProgress: async (entry) => {
      const finished = entry.durationSec > 0 && entry.positionSec / entry.durationSec >= 0.95
      if (entry.positionSec < 30 && !finished) {
        progressEntries.delete(entry.key)
        return
      }
      progressEntries.set(entry.key, { ...entry, finished, updatedAt: new Date().toISOString() })
    },
    clearPlaybackProgress: async (key) => {
      progressEntries.delete(key)
    },

    onScanProgress: (cb) => emitter.on('scanProgress', cb),
    onLibraryChanged: (cb) => emitter.on('libraryChanged', cb),
    onServerStatuses: (cb) => emitter.on('serverStatuses', cb),
    onDownloads: (cb) => emitter.on('downloads', cb),
    onQueue: (cb) => emitter.on('queue', cb),
    onPlayerAttach: () => () => {}
  }

  window.api = api
}
