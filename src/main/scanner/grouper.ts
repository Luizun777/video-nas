// Módulo PURO: convierte la lista de archivos de video del walker en items lógicos
// (una película, o una serie con sus episodios). Sin fs ni electron: testeable directo.

import type {
  EpisodeEntry,
  LibraryItem,
  MediaKind,
  MoviePart,
  MovieVersion,
  ParsedName,
  ScanFolder
} from '@shared/types'
import {
  cleanTitle,
  describeVersion,
  hasVideoExtension,
  inferSeasonFromFolder,
  normalizeForCompare,
  parseEpisode,
  parseSeriesFolder
} from './name-parser'

export interface ScannedFile {
  /** Ruta relativa a la raíz del share, en POSIX. Ej: "Movies/Avatar (2009)/Avatar.mkv" */
  relPath: string
  size: number
}

export interface GroupedItem {
  /** Ancla: carpeta de primer nivel o archivo suelto. Base del id del item. */
  relPath: string
  kind: MediaKind
  parsed: ParsedName
  videoRelPath?: string
  parts?: MoviePart[]
  /**
   * SIEMPRE poblado (≥1) para películas mientras el item viaja por el pipeline de
   * agrupación/fusión — es la fuente de verdad que usa mergeDuplicateMovies para comparar
   * tamaños entre anclas distintas. Se poda a `undefined` (cuando queda 1) recién al
   * construir el LibraryItem final en scan-orchestrator.ts, que es donde de verdad importa
   * el invariante "versions solo si hay ≥2 copias".
   */
  versions?: MovieVersion[]
  episodes?: EpisodeEntry[]
  /** Rutas de anclas que esta fusión absorbió (mergeDuplicateMovies). */
  absorbedRelPaths?: string[]
}

/** Umbral bajo el cual un video se considera extra/muestra si existe otro mucho mayor. */
const SMALL_FILE_BYTES = 100 * 1024 * 1024
/** Si el segundo archivo supera este porcentaje del mayor, se considera otra película. */
const SIBLING_RATIO = 0.4

const SAMPLE_RE = /\b(?:sample|muestra|trailer|tr[aá]iler|extras?|behind|featurette)\b/i

function baseName(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? relPath : relPath.slice(idx + 1)
}

/** Ordena "cap 2" antes que "cap 10". */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
}

/** Quita el prefijo de la carpeta raíz configurada y devuelve los segmentos restantes. */
function segmentsUnderRoot(relPath: string, root: string): string[] {
  const prefix = root.endsWith('/') ? root : root + '/'
  if (!relPath.startsWith(prefix)) return []
  return relPath.slice(prefix.length).split('/').filter(Boolean)
}

// ---------------------------------------------------------------------------
// Películas
// ---------------------------------------------------------------------------

function pickMainVideos(files: ScannedFile[]): ScannedFile[] {
  const notSamples = files.filter((f) => !SAMPLE_RE.test(baseName(f.relPath)))
  const pool = notSamples.length > 0 ? notSamples : files
  if (pool.length <= 1) return pool

  const sorted = [...pool].sort((a, b) => b.size - a.size)
  const largest = sorted[0]
  // Solo se conservan los que compiten en tamaño con el mayor: el resto son extras.
  return sorted.filter(
    (f) => f === largest || (f.size >= SMALL_FILE_BYTES && f.size >= largest.size * SIBLING_RATIO)
  )
}

function singleFileVersion(file: ScannedFile): MovieVersion {
  return { label: describeVersion(baseName(file.relPath), file.size), videoRelPath: file.relPath, size: file.size }
}

function buildMovieFromFolder(folderRelPath: string, files: ScannedFile[]): GroupedItem[] {
  const folderName = baseName(folderRelPath)
  const folderParsed = cleanTitle(folderName)
  const mains = pickMainVideos(files)

  if (mains.length === 0) return []

  if (mains.length === 1) {
    const file = mains[0]
    return [
      {
        relPath: folderRelPath,
        kind: 'movie',
        parsed: stripPart(folderParsed),
        videoRelPath: file.relPath,
        versions: [singleFileVersion(file)]
      }
    ]
  }

  // Varios videos grandes: ¿son partes, copias en distinta calidad, o películas distintas?
  const parsedFiles = mains.map((f) => ({ file: f, parsed: cleanTitle(baseName(f.relPath)) }))
  const sameTitle = new Set(parsedFiles.map((p) => p.parsed.title.toLowerCase())).size === 1

  if (!sameTitle) {
    // Películas distintas dentro de una misma carpeta: cada archivo es su propio item.
    return parsedFiles.map((p) => ({
      relPath: p.file.relPath,
      kind: 'movie' as const,
      parsed: stripPart(p.parsed),
      videoRelPath: p.file.relPath,
      versions: [singleFileVersion(p.file)]
    }))
  }

  // Mismo título: los archivos CON número de parte forman UNA versión (con `parts`); cada
  // archivo SIN parte es su propia versión independiente. Cubre tanto "todo son partes"
  // (Kill Bill) como "copias alternativas sin partir" (Dreams) como el caso mixto de ambas.
  const withPart = parsedFiles.filter((p) => p.parsed.part !== undefined)
  const withoutPart = parsedFiles.filter((p) => p.parsed.part === undefined)
  const versions: MovieVersion[] = []

  if (withPart.length > 0) {
    const ordered = [...withPart].sort((a, b) =>
      naturalCompare(baseName(a.file.relPath), baseName(b.file.relPath))
    )
    const parts: MoviePart[] = ordered.map((p, i) => ({
      label: `Parte ${i + 1}`,
      videoRelPath: p.file.relPath
    }))
    const totalSize = ordered.reduce((sum, p) => sum + p.file.size, 0)
    versions.push({
      label: describeVersion(baseName(ordered[0].file.relPath), totalSize),
      videoRelPath: parts[0].videoRelPath,
      size: totalSize,
      parts
    })
  }

  for (const p of withoutPart) {
    versions.push(singleFileVersion(p.file))
  }

  versions.sort((a, b) => b.size - a.size)

  return [
    {
      relPath: folderRelPath,
      kind: 'movie',
      parsed: stripPart(folderParsed),
      videoRelPath: versions[0].videoRelPath,
      parts: versions[0].parts,
      versions
    }
  ]
}

function stripPart(parsed: { title: string; year?: number; part?: number }): ParsedName {
  return parsed.year !== undefined ? { title: parsed.title, year: parsed.year } : { title: parsed.title }
}

export function groupMovies(root: string, files: ScannedFile[]): GroupedItem[] {
  const topLevelFiles: ScannedFile[] = []
  const byFolder = new Map<string, ScannedFile[]>()

  for (const file of files) {
    const segments = segmentsUnderRoot(file.relPath, root)
    if (segments.length === 0) continue
    if (segments.length === 1) {
      topLevelFiles.push(file)
      continue
    }
    const folderRelPath = `${root}/${segments[0]}`
    const bucket = byFolder.get(folderRelPath)
    if (bucket) bucket.push(file)
    else byFolder.set(folderRelPath, [file])
  }

  const items: GroupedItem[] = []
  for (const [folderRelPath, folderFiles] of byFolder) {
    items.push(...buildMovieFromFolder(folderRelPath, folderFiles))
  }

  // Archivos sueltos: se agrupan entre sí solo si comparten título y ambos traen "Parte N".
  const looseByTitle = new Map<string, { file: ScannedFile; part?: number }[]>()
  for (const file of topLevelFiles) {
    const parsed = cleanTitle(baseName(file.relPath))
    const key = `${parsed.title.toLowerCase()}|${parsed.year ?? ''}`
    const bucket = looseByTitle.get(key)
    const entry = { file, part: parsed.part }
    if (bucket) bucket.push(entry)
    else looseByTitle.set(key, [entry])
  }

  for (const bucket of looseByTitle.values()) {
    const mergeable = bucket.length > 1 && bucket.every((b) => b.part !== undefined)
    if (mergeable) {
      const ordered = [...bucket].sort((a, b) =>
        naturalCompare(baseName(a.file.relPath), baseName(b.file.relPath))
      )
      const parsed = cleanTitle(baseName(ordered[0].file.relPath))
      const parts: MoviePart[] = ordered.map((entry, i) => ({
        label: `Parte ${i + 1}`,
        videoRelPath: entry.file.relPath
      }))
      const totalSize = ordered.reduce((sum, entry) => sum + entry.file.size, 0)
      items.push({
        relPath: ordered[0].file.relPath,
        kind: 'movie',
        parsed: stripPart(parsed),
        videoRelPath: ordered[0].file.relPath,
        parts,
        versions: [
          {
            label: describeVersion(baseName(ordered[0].file.relPath), totalSize),
            videoRelPath: parts[0].videoRelPath,
            size: totalSize,
            parts
          }
        ]
      })
    } else {
      for (const entry of bucket) {
        items.push({
          relPath: entry.file.relPath,
          kind: 'movie',
          parsed: stripPart(cleanTitle(baseName(entry.file.relPath))),
          videoRelPath: entry.file.relPath,
          versions: [singleFileVersion(entry.file)]
        })
      }
    }
  }

  return items.sort((a, b) => naturalCompare(a.parsed.title, b.parsed.title))
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

function buildEpisodes(seriesRoot: string, files: ScannedFile[]): EpisodeEntry[] {
  const known: EpisodeEntry[] = []
  /** Archivos sin número de episodio, agrupados por la temporada que sugiera su carpeta. */
  const unnumbered = new Map<number, ScannedFile[]>()

  for (const file of files) {
    const segments = segmentsUnderRoot(file.relPath, seriesRoot)
    if (segments.length === 0) continue
    const fileName = segments[segments.length - 1]
    const chain = segments.slice(0, -1)
    const parsed = parseEpisode(fileName, chain)
    if (parsed) {
      known.push({ season: parsed.season, episode: parsed.episode, relPath: file.relPath })
      continue
    }
    let season = 1
    for (let i = chain.length - 1; i >= 0; i--) {
      const inferred = inferSeasonFromFolder(chain[i])
      if (inferred !== null) {
        season = inferred
        break
      }
    }
    const bucket = unnumbered.get(season)
    if (bucket) bucket.push(file)
    else unnumbered.set(season, [file])
  }

  // Los que no traen número se numeran secuencialmente tras los conocidos de su temporada.
  for (const [season, bucket] of unnumbered) {
    const maxKnown = known
      .filter((e) => e.season === season)
      .reduce((max, e) => Math.max(max, e.episode), 0)
    const ordered = [...bucket].sort((a, b) => naturalCompare(a.relPath, b.relPath))
    ordered.forEach((file, i) => {
      known.push({ season, episode: maxKnown + i + 1, relPath: file.relPath })
    })
  }

  return known.sort((a, b) => a.season - b.season || a.episode - b.episode)
}

export function groupSeries(root: string, files: ScannedFile[]): GroupedItem[] {
  const bySeries = new Map<string, ScannedFile[]>()
  const looseFiles: ScannedFile[] = []

  for (const file of files) {
    const segments = segmentsUnderRoot(file.relPath, root)
    if (segments.length === 0) continue
    if (segments.length === 1) {
      looseFiles.push(file)
      continue
    }
    const seriesRelPath = `${root}/${segments[0]}`
    const bucket = bySeries.get(seriesRelPath)
    if (bucket) bucket.push(file)
    else bySeries.set(seriesRelPath, [file])
  }

  const items: GroupedItem[] = []
  for (const [seriesRelPath, seriesFiles] of bySeries) {
    const episodes = buildEpisodes(seriesRelPath, seriesFiles)
    if (episodes.length === 0) continue
    items.push({
      relPath: seriesRelPath,
      kind: 'tv',
      parsed: parseSeriesFolder(baseName(seriesRelPath)),
      episodes
    })
  }

  // Un video suelto dentro de TvShow se trata como serie de un solo episodio.
  for (const file of looseFiles) {
    const parsed = cleanTitle(baseName(file.relPath))
    const numbers = parseEpisode(baseName(file.relPath))
    items.push({
      relPath: file.relPath,
      kind: 'tv',
      parsed: stripPart(parsed),
      episodes: [
        {
          season: numbers?.season ?? 1,
          episode: numbers?.episode ?? 1,
          relPath: file.relPath
        }
      ]
    })
  }

  return items.sort((a, b) => naturalCompare(a.parsed.title, b.parsed.title))
}

export function groupFolder(folder: ScanFolder, files: ScannedFile[]): GroupedItem[] {
  return folder.kind === 'movie' ? groupMovies(folder.path, files) : groupSeries(folder.path, files)
}

// ---------------------------------------------------------------------------
// Fusión de duplicados entre anclas distintas (carpeta + archivo suelto, o dos archivos
// sueltos del mismo título). A diferencia de las "versiones dentro de una carpeta" de
// arriba, esto opera sobre TODO el conjunto de items ya agrupados del servidor —
// aplicado por el orquestador, no por groupMovies/groupFolder.
// ---------------------------------------------------------------------------

/** Un ancla de carpeta nunca termina en extensión de video; una de archivo suelto sí. */
function isFolderAnchor(item: GroupedItem): boolean {
  return !hasVideoExtension(item.relPath)
}

function totalVersionSize(item: GroupedItem): number {
  return (item.versions ?? []).reduce((sum, v) => sum + v.size, 0)
}

/**
 * Ancla determinista para que el id (`${serverId}:${relPath}`) sea estable entre
 * escaneos: gana la carpeta si existe; si hay varias o ninguna, la de mayor tamaño total;
 * desempate alfabético. Es independiente del orden de entrada.
 */
function pickAnchor(bucket: GroupedItem[]): GroupedItem {
  const folders = bucket.filter(isFolderAnchor)
  const pool = folders.length > 0 ? folders : bucket
  return [...pool].sort((a, b) => {
    const bySize = totalVersionSize(b) - totalVersionSize(a)
    return bySize !== 0 ? bySize : naturalCompare(a.relPath, b.relPath)
  })[0]
}

function mergeBucket(bucket: GroupedItem[]): GroupedItem {
  const anchor = pickAnchor(bucket)
  const absorbed = bucket.filter((item) => item !== anchor)

  const seen = new Set<string>()
  const versions: MovieVersion[] = []
  for (const item of bucket) {
    for (const version of item.versions ?? []) {
      if (seen.has(version.videoRelPath)) continue
      seen.add(version.videoRelPath)
      versions.push(version)
    }
  }
  versions.sort((a, b) => b.size - a.size)

  return {
    relPath: anchor.relPath,
    kind: 'movie',
    parsed: anchor.parsed,
    videoRelPath: versions[0]?.videoRelPath ?? anchor.videoRelPath,
    parts: versions[0]?.parts,
    versions: versions.length > 1 ? versions : undefined,
    absorbedRelPaths: absorbed.map((item) => item.relPath)
  }
}

/**
 * Fusiona items `movie` cuyo (título normalizado, año) coincidan EXACTAMENTE — nunca
 * fusiona años distintos ni con-año contra sin-año, para no juntar por error un remake
 * ("Dune" 1984 vs 2021) con su original.
 */
export function mergeDuplicateMovies(items: GroupedItem[]): GroupedItem[] {
  const movies = items.filter((item) => item.kind === 'movie')
  const others = items.filter((item) => item.kind !== 'movie')

  const buckets = new Map<string, GroupedItem[]>()
  for (const item of movies) {
    const key = `${normalizeForCompare(item.parsed.title)}|${item.parsed.year ?? ''}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const merged: GroupedItem[] = []
  for (const bucket of buckets.values()) {
    merged.push(bucket.length === 1 ? bucket[0] : mergeBucket(bucket))
  }

  return [...merged, ...others]
}

// ---------------------------------------------------------------------------
// Segunda pasada de fusión: por identidad de TMDB en vez de por título de archivo.
//
// mergeDuplicateMovies (arriba) compara títulos ANTES de identificar, así que solo une
// copias cuyo nombre de archivo coincide. En la práctica eso falla todo el tiempo: la
// misma película con el nombre en inglés en un archivo y en español en otro ("Bring Her
// Back" / "Haz que regrese"), o con el año presente en una copia y ausente en la otra
// ("Pulp Fiction.mp4" vs "Pulp Fiction (1994)/..."). Una vez identificadas, el tmdb.id es
// la verdad: si dos items ya reconocidos apuntan al mismo id, son la misma película sin
// importar cómo se llamen sus archivos.
// ---------------------------------------------------------------------------

export interface TmdbMergePlan {
  anchorId: string
  versions: MovieVersion[]
  absorbedIds: string[]
}

function versionsOfLibraryItem(item: LibraryItem): MovieVersion[] {
  if (item.versions && item.versions.length > 0) return item.versions
  if (!item.videoRelPath) return []
  const size = item.primarySize ?? 0
  return [
    {
      label: describeVersion(baseName(item.videoRelPath), size),
      videoRelPath: item.videoRelPath,
      size,
      parts: item.parts
    }
  ]
}

/**
 * Agrupa películas ya identificadas por `${serverId}:${mediaType}:${tmdbId}` y arma un
 * plan de fusión para cada bucket con más de un item. No decide nada sobre items sin
 * `tmdb` (unidentified/file-only) ni sobre series: esos ya quedaron cubiertos, o no,
 * por mergeDuplicateMovies — este paso es un refinamiento posterior, no un reemplazo.
 */
export function planTmdbMerges(items: LibraryItem[]): TmdbMergePlan[] {
  const buckets = new Map<string, LibraryItem[]>()
  for (const item of items) {
    if (item.kind !== 'movie' || item.missing || !item.tmdb) continue
    const key = `${item.serverId}:${item.tmdb.mediaType}:${item.tmdb.id}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const plans: TmdbMergePlan[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue

    const withVersions = bucket.map((item) => ({ item, versions: versionsOfLibraryItem(item) }))
    const totalSize = (entry: (typeof withVersions)[number]): number =>
      entry.versions.reduce((sum, v) => sum + v.size, 0)

    const folders = withVersions.filter((entry) => isFolderAnchor(entry.item))
    const pool = folders.length > 0 ? folders : withVersions
    const anchorEntry = [...pool].sort((a, b) => {
      const bySize = totalSize(b) - totalSize(a)
      return bySize !== 0 ? bySize : naturalCompare(a.item.relPath, b.item.relPath)
    })[0]

    const seen = new Set<string>()
    const versions: MovieVersion[] = []
    for (const entry of withVersions) {
      for (const version of entry.versions) {
        if (seen.has(version.videoRelPath)) continue
        seen.add(version.videoRelPath)
        versions.push(version)
      }
    }
    versions.sort((a, b) => b.size - a.size)

    plans.push({
      anchorId: anchorEntry.item.id,
      versions,
      absorbedIds: bucket.filter((item) => item.id !== anchorEntry.item.id).map((item) => item.id)
    })
  }
  return plans
}
