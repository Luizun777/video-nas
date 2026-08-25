// Módulo PURO: sin imports de electron ni de fs, para que vitest lo pruebe directo.
// Toda la lógica de nombres raros del NAS vive aquí.

import type { ParsedName } from '@shared/types'

export const VIDEO_EXTENSIONS = [
  '.mkv',
  '.mp4',
  '.avi',
  '.m4v',
  '.mov',
  '.mpg',
  '.mpeg',
  '.wmv',
  '.ts',
  '.webm',
  '.flv',
  '.m2ts',
  '.divx',
  '.ogm'
]

/** Tokens de calidad / release: desde el primero que aparezca, se corta hasta el final. */
const QUALITY_TOKENS = [
  '2160p',
  '1080p',
  '1080i',
  '720p',
  '576p',
  '480p',
  '360p',
  '4k',
  'uhd',
  'hdr',
  'hdr10',
  'dolby',
  'bluray',
  'blu-ray',
  'brrip',
  'bdrip',
  'bdremux',
  'remux',
  'web-dl',
  'webdl',
  'webrip',
  'web',
  'hdrip',
  'dvdrip',
  'dvdscr',
  'dvd',
  'hdtv',
  'cam',
  'telesync',
  'x264',
  'x265',
  'h264',
  'h265',
  'h.264',
  'h.265',
  'hevc',
  'avc',
  'xvid',
  'divx',
  '10bit',
  '8bit',
  'aac',
  'aac5',
  'ac3',
  'eac3',
  'dts',
  'dtshd',
  'truehd',
  'atmos',
  'mp3',
  'latino',
  'lat',
  'castellano',
  'esp',
  'dub',
  'doblada',
  'espanol',
  'español',
  'ingles',
  'inglés',
  'dual',
  'multi',
  'subtitulado',
  'subs',
  'sub',
  'vose',
  'vos',
  'yts',
  'yify',
  'rarbg',
  'fgt',
  'evo',
  'ettv',
  'eztv',
  'extended',
  'remastered',
  'unrated',
  'proper',
  'repack',
  'directors',
  'theatrical',
  'imax',
  'ultra'
]

const QUALITY_SET = new Set(QUALITY_TOKENS)

/** Etiquetas entre paréntesis que son variantes de edición, no parte del título. */
const EDITION_TAG_RE =
  /\((?:\s*(?:extended|remastered|unrated|uncut|director'?s\s+cut|theatrical|imax|4k|uhd|hdr|latino|dual|castellano|subtitulado|v\.?o\.?s\.?e?|edici[oó]n\s+\w+)\s*)\)/gi

const YEAR_IN_BRACKETS_RE = /[([]\s*((?:19|20)\d{2})\s*[)\]]/g
const TRAILING_YEAR_RE = /\b((?:19|20)\d{2})\s*$/
const PART_RE = /\b(?:parte|part|pt|cd|disco|disc)[\s._-]?(\d{1,2})(?:\s*-\s*\d{1,2})?\b/i

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return fileName
  const ext = fileName.slice(idx).toLowerCase()
  return VIDEO_EXTENSIONS.includes(ext) || ext.length <= 5 ? fileName.slice(0, idx) : fileName
}

export function hasVideoExtension(fileName: string): boolean {
  const idx = fileName.lastIndexOf('.')
  if (idx < 0) return false
  return VIDEO_EXTENSIONS.includes(fileName.slice(idx).toLowerCase())
}

/** Normaliza para comparar títulos: minúsculas, sin acentos, sin puntuación. */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isQualityToken(token: string): boolean {
  const clean = token.toLowerCase().replace(/^[[(\-]+|[\])\-]+$/g, '')
  if (!clean) return false
  if (QUALITY_SET.has(clean)) return true
  // "aac5.1", "dd5.1", "5.1", "7.1"
  if (/^(?:dd|ddp|aac|ac3|dts)?[257][.,]1$/.test(clean)) return true
  return false
}

/** Corta la cadena a partir del primer token de calidad/release. */
function cutAtQualityToken(value: string): string {
  const tokens = value.split(/\s+/)
  const idx = tokens.findIndex((t) => isQualityToken(t))
  if (idx === -1) return value
  // No dejar el título vacío: si el primer token ya es de calidad, conservar todo.
  if (idx === 0) return value
  return tokens.slice(0, idx).join(' ')
}

function tidy(value: string): string {
  return value
    .replace(/[._]+/g, ' ')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface CleanTitleResult extends ParsedName {
  part?: number
}

/**
 * Limpia un nombre de archivo o carpeta y extrae título, año y número de parte.
 *
 * El orden importa:
 *   1. quitar extensión
 *   2. detectar número de parte (antes de podar nada)
 *   3. año entre paréntesis/corchetes (tolera "300 (2006 )"), con prioridad sobre el
 *      año suelto al final; se corta todo lo que venga después del año
 *   4. quitar bloques [..] y etiquetas de edición (EXTENDED, 4K Ultra HD, ...)
 *   5. cortar desde el primer token de calidad
 */
export function cleanTitle(rawName: string): CleanTitleResult {
  // macOS entrega los nombres de archivo en NFD (acentos descompuestos). Sin recomponer
  // a NFC, TheMovieDB no reconoce ningún título con acento.
  let value = stripExtension(rawName.normalize('NFC'))

  const partMatch = value.match(PART_RE)
  const part = partMatch ? Number(partMatch[1]) : undefined
  if (partMatch) value = value.slice(0, partMatch.index).concat(' ')

  let year: number | undefined

  // Año entre paréntesis o corchetes. Se toma el ÚLTIMO, que es el del título
  // ("2001 odisea del espacio (1968)" -> 1968, no 2001).
  const bracketMatches = [...value.matchAll(YEAR_IN_BRACKETS_RE)]
  if (bracketMatches.length > 0) {
    const last = bracketMatches[bracketMatches.length - 1]
    year = Number(last[1])
    // Todo lo que sigue al año son tags de release.
    value = value.slice(0, last.index)
  } else {
    // Año "suelto" separado por puntos/espacios: Avatar.2009.2160p...
    const dotted = value.match(/[\s._]((?:19|20)\d{2})(?=[\s._])/)
    if (dotted) {
      year = Number(dotted[1])
      value = value.slice(0, dotted.index)
    } else {
      const trailing = tidy(value).match(TRAILING_YEAR_RE)
      if (trailing) {
        const candidate = tidy(value)
        // No robar el año si el título es solo ese número ("2012")
        if (candidate.replace(TRAILING_YEAR_RE, '').trim().length > 0) {
          year = Number(trailing[1])
          value = candidate.replace(TRAILING_YEAR_RE, '')
        }
      }
    }
  }

  value = value.replace(/\[[^\]]*\]/g, ' ')
  value = value.replace(EDITION_TAG_RE, ' ')
  value = tidy(value)
  value = cutAtQualityToken(value)
  value = value.replace(/\(\s*\)/g, ' ')
  value = tidy(value)
  // Paréntesis abierto sin cerrar tras los cortes
  value = value.replace(/\s*\([^)]*$/, '').trim()

  const title = value.length > 0 ? value : tidy(stripExtension(rawName.normalize('NFC')))
  return year !== undefined ? { title, year, part } : { title, part }
}

export function parseMovieName(source: string): CleanTitleResult {
  return cleanTitle(source)
}

export function parseSeriesFolder(folderName: string): ParsedName {
  const { title, year } = cleanTitle(folderName)
  return year !== undefined ? { title, year } : { title }
}

// ---------------------------------------------------------------------------
// Descripción de versiones: para cuando la misma película existe en más de una
// calidad/copia y hay que explicarle al usuario en qué se diferencian.
// ---------------------------------------------------------------------------

/** "15.3 GB" por encima de 1 GB; "820 MB" por debajo. */
export function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return `${Math.round(mb)} MB`
}

type QualityCategory = 'resolution' | 'source' | 'codec' | 'hdr' | 'language' | 'edition'

/** Un token por categoría gana: la primera aparición en el nombre del archivo. */
const TAG_CLASSIFY: Record<string, { category: QualityCategory; label: string }> = {
  '2160p': { category: 'resolution', label: '4K' },
  '4k': { category: 'resolution', label: '4K' },
  uhd: { category: 'resolution', label: '4K' },
  '1080p': { category: 'resolution', label: '1080p' },
  '1080i': { category: 'resolution', label: '1080p' },
  '720p': { category: 'resolution', label: '720p' },
  '576p': { category: 'resolution', label: '576p' },
  '480p': { category: 'resolution', label: '480p' },
  '360p': { category: 'resolution', label: '360p' },

  bluray: { category: 'source', label: 'BluRay' },
  'blu-ray': { category: 'source', label: 'BluRay' },
  brrip: { category: 'source', label: 'BluRay' },
  bdrip: { category: 'source', label: 'BluRay' },
  bdremux: { category: 'source', label: 'BluRay Remux' },
  remux: { category: 'source', label: 'Remux' },
  'web-dl': { category: 'source', label: 'WEB-DL' },
  webdl: { category: 'source', label: 'WEB-DL' },
  webrip: { category: 'source', label: 'WEBRip' },
  web: { category: 'source', label: 'WEB' },
  hdrip: { category: 'source', label: 'HDRip' },
  dvdrip: { category: 'source', label: 'DVDRip' },
  dvdscr: { category: 'source', label: 'DVD Screener' },
  dvd: { category: 'source', label: 'DVD' },
  hdtv: { category: 'source', label: 'HDTV' },
  cam: { category: 'source', label: 'CAM' },
  telesync: { category: 'source', label: 'TS' },

  x264: { category: 'codec', label: 'x264' },
  h264: { category: 'codec', label: 'x264' },
  x265: { category: 'codec', label: 'x265' },
  h265: { category: 'codec', label: 'x265' },
  hevc: { category: 'codec', label: 'x265' },
  avc: { category: 'codec', label: 'AVC' },
  xvid: { category: 'codec', label: 'XviD' },
  divx: { category: 'codec', label: 'DivX' },

  hdr: { category: 'hdr', label: 'HDR' },
  hdr10: { category: 'hdr', label: 'HDR10' },
  dolby: { category: 'hdr', label: 'Dolby' },
  atmos: { category: 'hdr', label: 'Atmos' },
  truehd: { category: 'hdr', label: 'TrueHD' },

  latino: { category: 'language', label: 'Latino' },
  lat: { category: 'language', label: 'Latino' },
  castellano: { category: 'language', label: 'Castellano' },
  esp: { category: 'language', label: 'Español' },
  espanol: { category: 'language', label: 'Español' },
  español: { category: 'language', label: 'Español' },
  dual: { category: 'language', label: 'Dual' },
  multi: { category: 'language', label: 'Multi' },
  subtitulado: { category: 'language', label: 'Subtitulado' },
  vose: { category: 'language', label: 'VOSE' },
  vos: { category: 'language', label: 'VOS' },
  dub: { category: 'language', label: 'Doblada' },
  doblada: { category: 'language', label: 'Doblada' },

  extended: { category: 'edition', label: 'Extended' },
  remastered: { category: 'edition', label: 'Remasterizada' },
  unrated: { category: 'edition', label: 'Sin censura' },
  directors: { category: 'edition', label: "Director's Cut" },
  theatrical: { category: 'edition', label: 'Versión de cine' },
  imax: { category: 'edition', label: 'IMAX' }
}

const CATEGORY_ORDER: QualityCategory[] = ['resolution', 'source', 'codec', 'hdr', 'language', 'edition']
const MAX_QUALITY_TAGS = 4

/**
 * Etiquetas de calidad legibles para comparar versiones de un mismo archivo, en el orden
 * resolución → fuente → códec → HDR/audio → idioma → edición, máximo 4. Dentro de cada
 * categoría gana el primer token que aparece en el nombre.
 */
export function extractQualityTags(fileName: string): string[] {
  const withoutExt = stripExtension(fileName.normalize('NFC'))
  const normalized = withoutExt
    .replace(/h\.264/gi, 'h264')
    .replace(/h\.265/gi, 'h265')
    .replace(/[[\]()]/g, ' ')
    .replace(/[._]+/g, ' ')

  const found = new Map<QualityCategory, string>()
  const consider = (token: string): void => {
    const clean = token.toLowerCase().replace(/^-+|-+$/g, '')
    const entry = clean ? TAG_CLASSIFY[clean] : undefined
    if (entry && !found.has(entry.category)) found.set(entry.category, entry.label)
  }

  for (const rawToken of normalized.split(/\s+/)) {
    if (!rawToken) continue
    const whole = rawToken.toLowerCase().replace(/^-+|-+$/g, '')
    if (TAG_CLASSIFY[whole]) {
      consider(whole)
      continue
    }
    // No es un compuesto conocido (blu-ray, web-dl): puede ser varios tags pegados por
    // guiones sin espacios, como "1080P-Dual-Lat". Se prueba cada trozo por separado.
    for (const part of rawToken.split('-')) consider(part)
  }

  const tags: string[] = []
  for (const category of CATEGORY_ORDER) {
    const label = found.get(category)
    if (label) tags.push(label)
    if (tags.length >= MAX_QUALITY_TAGS) break
  }
  return tags
}

function containerLabel(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx < 0 ? '' : fileName.slice(idx + 1).toUpperCase()
}

/** "4K BluRay x265 · MKV · 15.3 GB" — la descripción que ve el usuario en el selector. */
export function describeVersion(fileName: string, size: number): string {
  const tags = extractQualityTags(fileName)
  const container = containerLabel(fileName)
  const sizeLabel = formatSize(size)
  const segments = tags.length > 0 ? [tags.join(' '), container, sizeLabel] : [container, sizeLabel]
  return segments.filter(Boolean).join(' · ')
}

export interface EpisodeNumbers {
  season: number
  episode: number
}

const SXXEYY_RE = /\bs(\d{1,2})[\s._-]?e(\d{1,3})\b/i
const NXNN_RE = /\b(\d{1,2})x(\d{2,3})\b/i
const SEASON_FOLDER_RE = /^(?:season|temporada|temp\.?|seas\.?|s|t)[\s._-]?(\d{1,2})$/i
const TRAILING_DIGITS_RE = /(\d{1,2})\s*$/
const EPISODE_HINT_RE = /(?:^|[\s._-])(?:e|ep|episodio|episode|cap|capitulo|capítulo)[\s._-]?(\d{1,3})\b/i

/** Deduce el número de temporada del nombre de una subcarpeta ("Temporada 2", "TBBT1"). */
export function inferSeasonFromFolder(folderName: string): number | null {
  const named = folderName.trim().match(SEASON_FOLDER_RE)
  if (named) return Number(named[1])
  // Nombres arbitrarios que terminan en dígitos: TBBT1, TBBT2
  const trailing = folderName.trim().match(TRAILING_DIGITS_RE)
  if (trailing) return Number(trailing[1])
  return null
}

/**
 * Deduce temporada y episodio de un archivo, usando la cadena de subcarpetas que hay
 * entre la carpeta de la serie y el archivo como pista de temporada.
 *
 * Devuelve null si no encuentra número de episodio: el grouper numerará esos archivos
 * secuencialmente por orden alfabético.
 */
export function parseEpisode(fileName: string, subfolderChain: string[] = []): EpisodeNumbers | null {
  const base = stripExtension(fileName)

  const sxxeyy = base.match(SXXEYY_RE)
  if (sxxeyy) return { season: Number(sxxeyy[1]), episode: Number(sxxeyy[2]) }

  const nxnn = base.match(NXNN_RE)
  if (nxnn) return { season: Number(nxnn[1]), episode: Number(nxnn[2]) }

  // Temporada desde la subcarpeta más profunda que dé un número.
  let season: number | null = null
  for (let i = subfolderChain.length - 1; i >= 0; i--) {
    season = inferSeasonFromFolder(subfolderChain[i])
    if (season !== null) break
  }

  const hinted = base.match(EPISODE_HINT_RE)
  if (hinted) return { season: season ?? 1, episode: Number(hinted[1]) }

  const trailing = base.match(/(\d{1,3})\s*$/)
  if (trailing) return { season: season ?? 1, episode: Number(trailing[1]) }

  return null
}
