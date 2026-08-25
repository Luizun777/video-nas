import type { LibraryItem } from './types'
import { BACKDROP_SIZE, POSTER_SIZE, tmdbImageUrl } from './tmdb-images'

// El renderer nunca decide CÓMO se sirve una imagen cacheada: en Electron es el
// protocolo mediacache://, en Android una URL de archivo local de Capacitor. La
// plataforma registra su resolver al arrancar; sin registrar nada aplica el
// comportamiento de Electron de siempre.

export type MediaSrcResolver = (cacheRelPath: string) => string

let resolver: MediaSrcResolver = (cacheRelPath) => `mediacache://${cacheRelPath}`
let tmdbDirectFallback = false

export function setMediaSrcResolver(next: MediaSrcResolver): void {
  resolver = next
}

/**
 * Android lo activa: si un título aún no tiene imagen cacheada (escaneo en frío),
 * se muestra la URL directa de TMDB en vez del placeholder. El desktop no lo usa
 * para no cambiar su comportamiento (cachea siempre antes de mostrar).
 */
export function enableTmdbDirectFallback(): void {
  tmdbDirectFallback = true
}

type MediaItem = Pick<LibraryItem, 'posterCache' | 'backdropCache' | 'tmdb'>

/** URL lista para <img> o background-image del póster, o null (→ placeholder). */
export function posterSrc(item: MediaItem): string | null {
  if (item.posterCache) return resolver(item.posterCache)
  if (tmdbDirectFallback && item.tmdb?.posterPath) {
    return tmdbImageUrl(item.tmdb.posterPath, POSTER_SIZE)
  }
  return null
}

export function backdropSrc(item: MediaItem): string | null {
  if (item.backdropCache) return resolver(item.backdropCache)
  if (tmdbDirectFallback && item.tmdb?.backdropPath) {
    return tmdbImageUrl(item.tmdb.backdropPath, BACKDROP_SIZE)
  }
  return null
}
