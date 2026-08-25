import type { IdentifyState, LibraryItem, MediaKind, TmdbMatch } from '@shared/types'
import { normalizeForCompare } from '@core/scanner/name-parser'
import { getById, search, toMatch } from './client'
import type { ImageCacheAdapter } from '../io'

export interface IdentifyOutcome {
  identify: IdentifyState
  tmdb: TmdbMatch | null
  posterCache?: string
  backdropCache?: string
}

interface TmdbRawLike {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
  popularity?: number
}

function yearOf(raw: TmdbRawLike): number | null {
  const date = raw.release_date || raw.first_air_date
  if (!date) return null
  const year = Number(date.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

export const TITLE_SCORE: { exact: number; none: number } = {
  exact: 100,
  none: 0
}

// Cuánto se parecen dos títulos, con dos reglas distintas según DÓNDE cae la coincidencia:
//
//  - Al principio: basta con que el nombre del archivo sea el arranque del título de TMDB.
//    Así se identifican las series cuyo nombre completo es una frase larga: "Frieren" ->
//    "Frieren: Más allá del final del viaje", "Avatar" -> "Avatar: La leyenda de Aang".
//  - En medio o al final: se exige un solape amplio, porque una coincidencia suelta no
//    identifica nada ("300" aparece dentro de "Home Movies 300-1").
//
// En ambos casos la comparación es por palabras completas, lo que evita que
// "3001 Kosmine Odiseja" cuente como parecido a "300".

const PREFIX_BASE = 60
const PREFIX_RANGE = 30
const CONTAINMENT_BASE = 40
const CONTAINMENT_RANGE = 50
const MIN_COVERAGE = 0.4
const MIN_TITLE_SCORE = PREFIX_BASE

function isWordPrefix(longer: string, shorter: string): boolean {
  return longer.startsWith(`${shorter} `)
}

/** 100 si son iguales, entre 60 y 90 si uno contiene al otro, 0 si no se parecen. */
export function titleAffinity(candidate: string, target: string): number {
  if (candidate === target) return TITLE_SCORE.exact

  const [shorter, longer] =
    candidate.length <= target.length ? [candidate, target] : [target, candidate]
  const coverage = shorter.length / longer.length

  if (isWordPrefix(longer, shorter)) return PREFIX_BASE + PREFIX_RANGE * coverage
  if (!` ${longer} `.includes(` ${shorter} `)) return TITLE_SCORE.none
  if (coverage < MIN_COVERAGE) return TITLE_SCORE.none
  return CONTAINMENT_BASE + CONTAINMENT_RANGE * coverage
}

// Umbrales de la vía débil (aceptar el primer resultado de TMDB cuando su título
// localizado no se parece al del archivo). La popularidad solo sirve para descartar
// material marginal: la basura que devuelve una búsqueda mal filtrada ronda 0.4.

/** Con año coincidente basta con que la obra exista de verdad en el catálogo. */
const MIN_WEAK_POPULARITY_WITH_YEAR = 1.5
/** Sin año, se exige un título largo y distintivo, y algo más de relevancia. */
const MIN_WEAK_POPULARITY_NO_YEAR = 3
const MIN_WEAK_WORDS_NO_YEAR = 4

export interface ScoredMatch<T> {
  raw: T
  /** Cuánto se parece el título, ignorando el año. */
  titleScore: number
  /** titleScore + bonus por año y popularidad. */
  score: number
}

/**
 * Puntúa los resultados comparando el título normalizado (minúsculas, sin acentos ni
 * puntuación) contra el título traducido y el original.
 *
 * El año NO puede compensar un título que no se parece: buscar "300" con año 2006
 * devuelve películas irrelevantes de ese año, y aceptarlas daría una portada equivocada.
 */
export function pickBestMatch<T extends TmdbRawLike>(
  results: T[],
  title: string,
  year?: number
): ScoredMatch<T> | null {
  if (results.length === 0) return null
  const target = normalizeForCompare(title)

  const scored: ScoredMatch<T>[] = results.map((raw) => {
    const candidates = [raw.title, raw.name, raw.original_title, raw.original_name]
      .filter((value): value is string => Boolean(value))
      .map(normalizeForCompare)
      .filter((value) => value.length > 0)

    const titleScore = candidates.reduce(
      (best, candidate) => Math.max(best, titleAffinity(candidate, target)),
      TITLE_SCORE.none
    )

    const resultYear = yearOf(raw)
    const yearMatch = year !== undefined && resultYear !== null && Math.abs(resultYear - year) <= 1

    const score = titleScore + (yearMatch ? 40 : 0) + Math.min(raw.popularity ?? 0, 20) / 4

    return { raw, titleScore, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (best.titleScore >= MIN_TITLE_SCORE) return best

  // Ningún título se parece, pero TMDB busca también por títulos alternativos: su primer
  // resultado suele ser el correcto cuando el título localizado no tiene nada que ver con
  // el del archivo ("Korra" -> "La leyenda de Korra"). Solo se acepta si además cuadra el
  // año y la película es mínimamente conocida, que es lo que separa un acierto de la
  // basura que devuelve una búsqueda como "300" filtrada por un año equivocado.
  const topHit = results[0]
  const popularity = topHit.popularity ?? 0
  const topYear = yearOf(topHit)

  if (year !== undefined) {
    // Con año conocido, que NO cuadre es señal fuerte de que no es la película.
    const yearMatches = topYear !== null && Math.abs(topYear - year) <= 1
    if (yearMatches && popularity >= MIN_WEAK_POPULARITY_WITH_YEAR) {
      return { raw: topHit, titleScore: TITLE_SCORE.none, score: 40 }
    }
    return null
  }

  // Sin año en el archivo solo queda fiarse del texto: se exige un título largo y
  // específico, donde es improbable que TMDB devuelva otra cosa por casualidad.
  const words = target.split(' ').filter(Boolean).length
  if (words >= MIN_WEAK_WORDS_NO_YEAR && popularity >= MIN_WEAK_POPULARITY_NO_YEAR) {
    return { raw: topHit, titleScore: TITLE_SCORE.none, score: 20 }
  }

  return null
}

/** Recorta el título a las primeras palabras para un último intento de búsqueda. */
function shortenTitle(title: string): string | null {
  const words = title.split(/\s+/).filter(Boolean)
  if (words.length <= 2) return null
  return words.slice(0, Math.max(2, Math.ceil(words.length / 2))).join(' ')
}

async function withImages(match: TmdbMatch, images?: ImageCacheAdapter): Promise<IdentifyOutcome> {
  if (!images) return { identify: 'auto', tmdb: match }
  const [posterCache, backdropCache] = await Promise.all([
    images.cachePoster(match.mediaType, match.id, match.posterPath),
    images.cacheBackdrop(match.mediaType, match.id, match.backdropPath)
  ])
  return { identify: 'auto', tmdb: match, posterCache, backdropCache }
}

export interface IdentifyContext {
  token: string | null
  language: string
  /** Sin images el match se devuelve sin cachear portadas (tests, modo degradado). */
  images?: ImageCacheAdapter
}

/** Búsqueda automática: título+año, luego sin año, luego título recortado. */
export async function identifyItem(
  item: Pick<LibraryItem, 'parsed' | 'kind'>,
  ctx: IdentifyContext
): Promise<IdentifyOutcome> {
  if (!ctx.token) return { identify: 'unidentified', tmdb: null }

  const { title, year } = item.parsed
  const kind: MediaKind = item.kind

  const attempts: { query: string; year?: number }[] = [{ query: title, year }]
  if (year !== undefined) attempts.push({ query: title })
  const shorter = shortenTitle(title)
  if (shorter) attempts.push({ query: shorter })

  // Una coincidencia exacta se acepta al vuelo; si no, se prueban todos los intentos y
  // se conserva el mejor parcial, para no quedarse con el primer resultado mediocre.
  let bestSoFar: ReturnType<typeof pickBestMatch<Awaited<ReturnType<typeof search>>[number]>> = null

  for (const attempt of attempts) {
    let results: Awaited<ReturnType<typeof search>>
    try {
      results = await search(ctx.token, ctx.language, kind, attempt.query, attempt.year)
    } catch {
      break
    }

    const best = pickBestMatch(results, title, year)
    if (!best) continue
    if (best.titleScore >= TITLE_SCORE.exact) {
      return withImages(toMatch(best.raw, kind), ctx.images)
    }
    if (!bestSoFar || best.score > bestSoFar.score) bestSoFar = best
    // Los intentos siguientes (sin año, con el título recortado) existen para cuando no
    // hay nada, no para mejorar un acierto: buscar "Big Bang" tras encontrar
    // "The Big Bang Theory" solo puede empeorar el resultado.
    if (best.titleScore >= MIN_TITLE_SCORE) break
  }

  if (bestSoFar) return withImages(toMatch(bestSoFar.raw, kind), ctx.images)
  return { identify: 'unidentified', tmdb: null }
}

/** Identificación forzada por id concreto (correcciones manuales del usuario). */
export async function identifyByTmdbId(
  kind: MediaKind,
  tmdbId: number,
  ctx: IdentifyContext
): Promise<IdentifyOutcome> {
  if (!ctx.token) return { identify: 'unidentified', tmdb: null }
  try {
    const match = await getById(ctx.token, ctx.language, kind, tmdbId)
    const outcome = await withImages(match, ctx.images)
    return { ...outcome, identify: 'manual' }
  } catch {
    return { identify: 'unidentified', tmdb: null }
  }
}
