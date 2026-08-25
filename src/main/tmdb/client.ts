import type {
  CastMember,
  ExtraDetails,
  MediaKind,
  RelatedTitle,
  TmdbMatch,
  TmdbSearchResult,
  TvDetails
} from '@shared/types'
import { BACKDROP_SIZE, IMAGE_BASE, POSTER_SIZE, THUMB_SIZE } from '@shared/tmdb-images'

const API_BASE = 'https://api.themoviedb.org/3'
export { IMAGE_BASE, POSTER_SIZE, BACKDROP_SIZE, THUMB_SIZE }

const MAX_CONCURRENT = 3
const MIN_SPACING_MS = 250

/** Limitador de concurrencia mínimo: evita una dependencia externa en el proceso main. */
class RequestQueue {
  private active = 0
  private lastStart = 0
  private readonly pending: (() => void)[] = []

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = async (): Promise<void> => {
        this.active++
        const wait = Math.max(0, this.lastStart + MIN_SPACING_MS - Date.now())
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        this.lastStart = Date.now()
        try {
          resolve(await task())
        } catch (error) {
          reject(error)
        } finally {
          this.active--
          const next = this.pending.shift()
          if (next) next()
        }
      }
      if (this.active < MAX_CONCURRENT) void start()
      else this.pending.push(() => void start())
    })
  }
}

const queue = new RequestQueue()

export class TmdbError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'TmdbError'
  }
}

interface TmdbRawResult {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  genre_ids?: number[]
}

async function request<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  return queue.run(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000)
        })
      } catch (error) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200))
          continue
        }
        throw new TmdbError(`Error de red al consultar TheMovieDB: ${(error as Error).message}`)
      }

      if (response.status === 429 && attempt === 0) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '2')
        await new Promise((r) => setTimeout(r, Math.min(10, retryAfter) * 1000))
        continue
      }
      if (response.status === 401) {
        throw new TmdbError('El token de TheMovieDB no es válido.', 401)
      }
      if (!response.ok) {
        throw new TmdbError(`TheMovieDB respondió ${response.status}.`, response.status)
      }
      return (await response.json()) as T
    }
    throw new TmdbError('No se pudo completar la consulta a TheMovieDB.')
  })
}

function yearOf(raw: TmdbRawResult): number | null {
  const date = raw.release_date || raw.first_air_date
  if (!date) return null
  const year = Number(date.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

function toSearchResult(raw: TmdbRawResult, kind: MediaKind): TmdbSearchResult {
  return {
    id: raw.id,
    mediaType: kind,
    title: raw.title || raw.name || 'Sin título',
    originalTitle: raw.original_title || raw.original_name || '',
    overview: raw.overview || '',
    year: yearOf(raw),
    posterUrl: raw.poster_path ? `${IMAGE_BASE}/${THUMB_SIZE}${raw.poster_path}` : null,
    voteAverage: raw.vote_average ?? 0
  }
}

export function toMatch(raw: TmdbRawResult, kind: MediaKind): TmdbMatch {
  return {
    id: raw.id,
    mediaType: kind,
    title: raw.title || raw.name || 'Sin título',
    originalTitle: raw.original_title || raw.original_name || '',
    overview: raw.overview || '',
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    releaseDate: raw.release_date || raw.first_air_date || null,
    voteAverage: raw.vote_average ?? 0,
    genreIds: raw.genre_ids ?? [],
    matchedAt: new Date().toISOString()
  }
}

export async function search(
  token: string,
  language: string,
  kind: MediaKind,
  query: string,
  year?: number
): Promise<TmdbRawResult[]> {
  const params: Record<string, string> = { query, language, include_adult: 'false' }
  if (year) params[kind === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = String(year)
  const data = await request<{ results?: TmdbRawResult[] }>(
    token,
    kind === 'movie' ? '/search/movie' : '/search/tv',
    params
  )
  return data.results ?? []
}

export async function searchAsResults(
  token: string,
  language: string,
  kind: MediaKind,
  query: string,
  year?: number
): Promise<TmdbSearchResult[]> {
  const raw = await search(token, language, kind, query, year)
  return raw.slice(0, 20).map((r) => toSearchResult(r, kind))
}

export async function getById(
  token: string,
  language: string,
  kind: MediaKind,
  id: number
): Promise<TmdbMatch> {
  const raw = await request<TmdbRawResult & { genres?: { id: number }[] }>(
    token,
    `${kind === 'movie' ? '/movie' : '/tv'}/${id}`,
    { language }
  )
  const match = toMatch(raw, kind)
  if (raw.genres) match.genreIds = raw.genres.map((g) => g.id)
  return match
}

interface TvSeasonRaw {
  season_number: number
  name?: string
  episodes?: { episode_number: number; name?: string }[]
}

export async function getTvSeasons(token: string, language: string, tvId: number): Promise<TvDetails> {
  const detail = await request<{ seasons?: { season_number: number; name?: string }[] }>(
    token,
    `/tv/${tvId}`,
    { language }
  )
  const seasonNumbers = (detail.seasons ?? [])
    .map((s) => s.season_number)
    .filter((n) => Number.isFinite(n))

  const seasons = await Promise.all(
    seasonNumbers.map(async (seasonNumber) => {
      try {
        const raw = await request<TvSeasonRaw>(token, `/tv/${tvId}/season/${seasonNumber}`, {
          language
        })
        const episodeNames: Record<number, string> = {}
        for (const episode of raw.episodes ?? []) {
          if (episode.name) episodeNames[episode.episode_number] = episode.name
        }
        return {
          season: seasonNumber,
          name: raw.name || `Temporada ${seasonNumber}`,
          episodeNames
        }
      } catch {
        return { season: seasonNumber, name: `Temporada ${seasonNumber}`, episodeNames: {} }
      }
    })
  )

  return { seasons, fetchedAt: new Date().toISOString() }
}

interface CreditsRaw {
  cast?: { id: number; name: string; character?: string; order?: number; profile_path?: string | null }[]
  crew?: { job?: string; name: string }[]
}

interface AggregateCreditsRaw {
  cast?: {
    id: number
    name: string
    order?: number
    profile_path?: string | null
    roles?: { character?: string }[]
  }[]
}

interface RecommendationsRaw {
  results?: TmdbRawResult[]
}

interface CollectionRaw {
  parts?: TmdbRawResult[]
}

const MAX_CAST = 12
const MAX_RELATED = 12

function toCastMember(raw: {
  id: number
  name: string
  character?: string
  profile_path?: string | null
}): CastMember {
  return { id: raw.id, name: raw.name, character: raw.character ?? '', profilePath: raw.profile_path ?? null }
}

function toRelatedTitle(raw: TmdbRawResult, kind: MediaKind): RelatedTitle {
  return {
    id: raw.id,
    mediaType: kind,
    title: raw.title || raw.name || 'Sin título',
    year: yearOf(raw),
    posterPath: raw.poster_path ?? null
  }
}

/** Une colección + recomendaciones sin duplicar, con la colección (secuelas) primero. */
function mergeRelated(collectionParts: TmdbRawResult[], recommendations: TmdbRawResult[], kind: MediaKind, excludeId: number): RelatedTitle[] {
  const seen = new Set<number>([excludeId])
  const merged: RelatedTitle[] = []
  for (const raw of [...collectionParts, ...recommendations]) {
    if (seen.has(raw.id)) continue
    seen.add(raw.id)
    merged.push(toRelatedTitle(raw, kind))
    if (merged.length >= MAX_RELATED) break
  }
  return merged
}

/** Cada sub-llamada degrada a vacío si falla: un endpoint caído no debe tumbar el resto. */
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch {
    return fallback
  }
}

export async function getExtraDetails(
  token: string,
  language: string,
  kind: MediaKind,
  tmdbId: number
): Promise<ExtraDetails> {
  if (kind === 'movie') {
    const [detail, credits, recommendations] = await Promise.all([
      safe(
        request<{ belongs_to_collection?: { id: number } | null }>(token, `/movie/${tmdbId}`, { language }),
        {}
      ),
      safe(request<CreditsRaw>(token, `/movie/${tmdbId}/credits`, { language }), {}),
      safe(
        request<RecommendationsRaw>(token, `/movie/${tmdbId}/recommendations`, { language }),
        {}
      )
    ])

    let collectionParts: TmdbRawResult[] = []
    if (detail.belongs_to_collection?.id) {
      const collection = await safe(
        request<CollectionRaw>(token, `/collection/${detail.belongs_to_collection.id}`, { language }),
        {}
      )
      collectionParts = (collection.parts ?? []).filter((p) => p.id !== tmdbId)
    }

    const cast = (credits.cast ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, MAX_CAST)
      .map(toCastMember)
    const directors = (credits.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name)

    return {
      cast,
      directors,
      related: mergeRelated(collectionParts, recommendations.results ?? [], 'movie', tmdbId),
      fetchedAt: new Date().toISOString()
    }
  }

  // Series: aggregate_credits agrupa por persona con sus roles; si el endpoint no existe
  // para este título (algunos legacy devuelven 404), se cae a /credits.
  const [detail, aggregate, recommendations] = await Promise.all([
    safe(request<{ created_by?: { name: string }[] }>(token, `/tv/${tmdbId}`, { language }), {}),
    safe(request<AggregateCreditsRaw>(token, `/tv/${tmdbId}/aggregate_credits`, { language }), {}),
    safe(request<RecommendationsRaw>(token, `/tv/${tmdbId}/recommendations`, { language }), {})
  ])

  let cast: CastMember[]
  if (aggregate.cast && aggregate.cast.length > 0) {
    cast = aggregate.cast
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, MAX_CAST)
      .map((c) => toCastMember({ ...c, character: c.roles?.[0]?.character }))
  } else {
    const fallback = await safe(request<CreditsRaw>(token, `/tv/${tmdbId}/credits`, { language }), {})
    cast = (fallback.cast ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, MAX_CAST)
      .map(toCastMember)
  }

  return {
    cast,
    directors: (detail.created_by ?? []).map((c) => c.name),
    related: mergeRelated([], recommendations.results ?? [], 'tv', tmdbId),
    fetchedAt: new Date().toISOString()
  }
}

export async function testToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await request<unknown>(token, '/configuration', {})
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export async function downloadImage(path: string, size: string): Promise<Buffer | null> {
  try {
    const response = await fetch(`${IMAGE_BASE}/${size}${path}`, {
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}
