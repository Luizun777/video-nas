// Data model completo de la app. main, preload y renderer se tipan contra este archivo.

export type MediaKind = 'movie' | 'tv'

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

export interface ScanFolder {
  /** Ruta relativa a la raíz del share, ej. "Movies" */
  path: string
  kind: MediaKind
}

export interface ServerConfig {
  /** Identidad estable del servidor. Nunca cambia una vez creada. */
  id: string
  name: string
  /** IP, hostname.local, IP de tailnet (100.x.y.z) o nombre MagicDNS */
  host: string
  share: string
  /**
   * Credenciales SMB, usadas SOLO por Android (el desktop delega en el Llavero de macOS
   * al montar y las ignora). Viven en el config.json del sandbox de la app.
   */
  username?: string
  password?: string
  domain?: string
  folders: ScanFolder[]
  enabled: boolean
}

/** `embedded` = reproductor integrado en la app; `external` = abrir en otra aplicación. */
export type PlaybackMode = 'embedded' | 'external'

export interface AppConfig {
  version: 1
  /** Bearer v4 de TheMovieDB. null = modo sin API key. */
  tmdbBearerToken: string | null
  language: string
  servers: ServerConfig[]
  /** Carpeta local de descargas. Default: ~/Movies/Video NAS */
  downloadsPath?: string
  /** Default: 'embedded'. */
  playbackMode: PlaybackMode
  /** Ruta a un .app concreto. null/ausente = el que macOS tenga asociado. */
  externalPlayerPath?: string | null
  /** Default: true. */
  autoPlayNextEpisode: boolean
  /** Default: true. */
  autoSkipIntro: boolean
}

// ---------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------

export interface ParsedName {
  title: string
  year?: number
}

export interface MoviePart {
  label: string
  videoRelPath: string
}

/** Una copia alternativa de la misma película (distinta calidad, contenedor o idioma). */
export interface MovieVersion {
  /** "4K BluRay x265 · MKV · 15.3 GB" — ver describeVersion() en scanner/name-parser.ts */
  label: string
  /** Archivo principal de esta versión (= parts[0].videoRelPath si tiene parts) */
  videoRelPath: string
  size: number
  /** Partes de ESTA versión únicamente. Ortogonal a las demás versiones. */
  parts?: MoviePart[]
}

export interface EpisodeEntry {
  season: number
  episode: number
  relPath: string
}

export interface TmdbMatch {
  id: number
  mediaType: MediaKind
  title: string
  originalTitle: string
  overview: string
  posterPath: string | null
  backdropPath: string | null
  releaseDate: string | null
  voteAverage: number
  genreIds: number[]
  matchedAt: string
}

export interface TvSeasonDetails {
  season: number
  name: string
  /** número de episodio -> nombre */
  episodeNames: Record<number, string>
}

export interface TvDetails {
  seasons: TvSeasonDetails[]
  fetchedAt: string
}

export interface CastMember {
  id: number
  name: string
  character: string
  /** profile_path de TMDB, sin resolver a URL. null = sin foto. */
  profilePath: string | null
}

export interface RelatedTitle {
  id: number
  mediaType: MediaKind
  title: string
  year: number | null
  posterPath: string | null
}

export interface ExtraDetails {
  /** Primeros ~12 por orden de créditos */
  cast: CastMember[]
  /** movie: crew con job=Director. tv: created_by ("Creación"). */
  directors: string[]
  /** Colección (secuelas) primero, luego recomendaciones. Máx ~12, deduplicado. */
  related: RelatedTitle[]
  fetchedAt: string
}

/**
 * `auto`         identificado por búsqueda automática en TMDB
 * `manual`       el usuario eligió el título en el editor de metadata
 * `file-only`    el usuario pidió usar solo el nombre del archivo
 * `unidentified` sin match (sin token, o TMDB no devolvió nada)
 */
export type IdentifyState = 'auto' | 'manual' | 'file-only' | 'unidentified'

export interface LibraryItem {
  /** `${serverId}:${relPath}` */
  id: string
  serverId: string
  /** Ruta del "ancla" relativa al share: carpeta de la película/serie, o archivo suelto */
  relPath: string
  kind: MediaKind
  /** Siempre presente: es el fallback visual cuando no hay metadata de TMDB */
  parsed: ParsedName

  // Películas. videoRelPath/parts reflejan la versión por defecto (versions[0] si existe).
  videoRelPath?: string
  parts?: MoviePart[]
  /** Presente SOLO cuando hay ≥2 copias alternativas. versions[0] = la de mayor tamaño. */
  versions?: MovieVersion[]
  /**
   * Tamaño en bytes del video por defecto (versions[0] si hay varias, si no el único).
   * Se mantiene aunque `versions` esté podado a undefined: es lo que permite comparar
   * tamaños al fusionar por tmdb.id después de identificar (ver planTmdbMerges).
   */
  primarySize?: number

  // Series
  episodes?: EpisodeEntry[]
  tvDetails?: TvDetails | null

  identify: IdentifyState
  tmdb: TmdbMatch | null
  /** Reparto, dirección y relacionadas. Lazy al abrir el detalle, igual que tvDetails. */
  extraDetails?: ExtraDetails | null

  /** Rutas relativas dentro de userData/cache, ej. "posters/m-603-w342.jpg" */
  posterCache?: string
  backdropCache?: string

  /**
   * Fin del intro marcado a mano por el usuario, en segundos. Vive en el item de la SERIE
   * y se aplica por igual a todos sus episodios (las intros suelen durar lo mismo).
   * Solo se usa cuando el archivo no trae capítulos que identifiquen el intro.
   */
  introMark?: { seconds: number; setAt: string }

  firstSeenAt: string
  lastSeenAt: string
  /** Última vez que se preguntó a TMDB sin éxito: evita reintentar en cada arranque. */
  lastLookupAt?: string
  /** Título+año con los que se hizo esa búsqueda: si cambian, se vuelve a intentar. */
  lookupKey?: string
  /** true si desapareció del disco estando el servidor en línea */
  missing?: boolean
}

export interface Library {
  version: 1
  updatedAt: string
  items: Record<string, LibraryItem>
}

// ---------------------------------------------------------------------------
// Overrides (correcciones manuales). Archivo aparte para que el escaneo no las pise.
// ---------------------------------------------------------------------------

export interface MetadataOverride {
  mode: 'tmdb' | 'file-only'
  tmdbId?: number
  mediaType?: MediaKind
  setAt: string
}

export type Overrides = Record<string, MetadataOverride>

// ---------------------------------------------------------------------------
// Estado de servidores y escaneo
// ---------------------------------------------------------------------------

export type ServerState = 'online' | 'mounting' | 'offline' | 'disabled'

export interface ServerStatus {
  serverId: string
  state: ServerState
  mountPoint?: string
  message?: string
}

export type ScanPhase = 'idle' | 'mounting' | 'walking' | 'identifying' | 'images' | 'done' | 'error'

export interface ScanProgress {
  phase: ScanPhase
  serverId?: string
  serverName?: string
  current: number
  total: number
  label: string
  running: boolean
}

// ---------------------------------------------------------------------------
// TMDB (búsqueda manual)
// ---------------------------------------------------------------------------

export interface TmdbSearchResult {
  id: number
  mediaType: MediaKind
  title: string
  originalTitle: string
  overview: string
  year: number | null
  posterUrl: string | null
  voteAverage: number
}

export interface DiscoveredServer {
  name: string
  host: string
}

export interface PlayResult {
  ok: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Reproducción
// ---------------------------------------------------------------------------

/** Objetivo de reproducción. startAt = segundos iniciales (separar/volver conservan posición). */
export interface PlayTarget {
  itemId: string
  relPath?: string
  startAt?: number
}

/** Marcas de intro/créditos, vengan de capítulos del archivo o del marcado manual. */
export interface ChapterMarks {
  introEndSeconds?: number
  outroStartSeconds?: number
}

export interface ExternalPlayerInfo {
  name: string
  path: string
}

// ---------------------------------------------------------------------------
// Cola de reproducción (única, compartida entre ventanas, persistida en main)
// ---------------------------------------------------------------------------

export interface QueueEntry {
  itemId: string
  addedAt: string
}

export interface QueueFile {
  version: 1
  entries: QueueEntry[]
}

/** Qué sigue al terminar la reproducción actual. Prioridad: episodio > cola > nada. */
export type NextUpDecision =
  | { kind: 'episode'; episode: EpisodeEntry }
  | { kind: 'queue'; item: LibraryItem }
  | { kind: 'none' }

// ---------------------------------------------------------------------------
// Descargas (modo offline)
// ---------------------------------------------------------------------------

export type DownloadState = 'queued' | 'downloading' | 'done' | 'error'

export interface DownloadEntry {
  /** `${itemId}::${relPath}` — separador distinto de ":" porque itemId ya lo usa. */
  key: string
  itemId: string
  /** relPath del archivo fuente en el NAS. */
  relPath: string
  /** Ruta absoluta local, bajo AppConfig.downloadsPath. */
  localPath: string
  totalBytes: number
  bytesDone: number
  state: DownloadState
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface DownloadsFile {
  version: 1
  entries: Record<string, DownloadEntry>
}

// ---------------------------------------------------------------------------
// Capacidades por plataforma y progreso de reproducción
// ---------------------------------------------------------------------------

/** Qué sabe hacer la plataforma actual: el renderer oculta lo que no aplique. */
export interface AppCapabilities {
  platform: 'desktop' | 'android'
  /** Ventana separada del reproductor (multi-ventana de Electron). */
  separateWindow: boolean
  pip: boolean
  /** "Mostrar en Finder" o equivalente. */
  revealInFiles: boolean
  /** Diálogo del sistema para elegir una app externa concreta. */
  chooseExternalPlayerFile: boolean
  /** La plataforma necesita usuario/contraseña SMB por servidor. */
  smbCredentials: boolean
  mdnsDiscovery: boolean
}

export interface PlaybackProgressEntry {
  /** `${itemId}::${relPath}` — misma convención que las descargas. */
  key: string
  itemId: string
  relPath: string
  positionSec: number
  durationSec: number
  /** true cuando se vio casi completo: sale de "Continuar viendo". */
  finished: boolean
  updatedAt: string
}

export interface ProgressFile {
  version: 1
  entries: Record<string, PlaybackProgressEntry>
}

// ---------------------------------------------------------------------------
// Contrato IPC expuesto en window.api
// ---------------------------------------------------------------------------

export interface IpcApi {
  /** Síncrona: features de la plataforma. El renderer decide qué UI mostrar. */
  readonly capabilities: AppCapabilities

  getConfig(): Promise<AppConfig>
  saveConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  testTmdbToken(token: string): Promise<{ ok: boolean; error?: string }>

  getLibrary(): Promise<Library>
  getServerStatuses(): Promise<ServerStatus[]>
  refreshServerStatuses(): Promise<ServerStatus[]>

  startScan(opts?: { full?: boolean }): Promise<void>
  cancelScan(): Promise<void>
  getScanProgress(): Promise<ScanProgress>

  tmdbSearch(query: string, year: number | undefined, kind: MediaKind): Promise<TmdbSearchResult[]>
  applyOverride(itemId: string, override: MetadataOverride): Promise<LibraryItem | null>
  clearOverride(itemId: string): Promise<LibraryItem | null>
  getTvDetails(itemId: string): Promise<LibraryItem | null>
  getExtraDetails(itemId: string): Promise<LibraryItem | null>

  play(itemId: string, relPath?: string): Promise<PlayResult>
  revealInFinder(itemId: string, relPath?: string): Promise<PlayResult>

  getChapterMarks(itemId: string, relPath?: string): Promise<ChapterMarks>
  setIntroMark(itemId: string, seconds: number): Promise<LibraryItem | null>
  listExternalPlayers(): Promise<ExternalPlayerInfo[]>
  chooseExternalPlayer(): Promise<string | null>

  getQueue(): Promise<QueueEntry[]>
  addToQueue(itemId: string): Promise<QueueEntry[]>
  removeFromQueue(itemId: string): Promise<QueueEntry[]>
  clearQueue(): Promise<QueueEntry[]>
  /** Atómico en main: descarta cabezas inválidas o iguales a skipItemId y saca la primera válida. */
  shiftQueue(skipItemId?: string): Promise<QueueEntry | null>

  openPlayerWindow(target: PlayTarget): Promise<void>
  reattachPlayer(target: PlayTarget): Promise<void>
  consumePendingAttach(): Promise<PlayTarget | null>

  discoverSmbServers(): Promise<DiscoveredServer[]>
  purgeMissing(): Promise<number>

  startDownload(itemId: string, relPath?: string): Promise<PlayResult>
  cancelDownload(itemId: string, relPath: string): Promise<void>
  deleteDownload(itemId: string, relPath: string): Promise<void>
  getDownloads(): Promise<DownloadEntry[]>

  /**
   * Progreso de reproducción ("continuar viendo"). Opcionales: el desktop todavía no
   * los implementa, así que el renderer hace feature-detect antes de usarlos. finished
   * lo calcula el store según el porcentaje visto.
   */
  getPlaybackProgress?(): Promise<PlaybackProgressEntry[]>
  setPlaybackProgress?(entry: Omit<PlaybackProgressEntry, 'updatedAt' | 'finished'>): Promise<void>
  clearPlaybackProgress?(key: string): Promise<void>

  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onLibraryChanged(cb: (lib: Library) => void): () => void
  onServerStatuses(cb: (s: ServerStatus[]) => void): () => void
  onDownloads(cb: (entries: DownloadEntry[]) => void): () => void
  onQueue(cb: (entries: QueueEntry[]) => void): () => void
  onPlayerAttach(cb: (target: PlayTarget) => void): () => void
}
