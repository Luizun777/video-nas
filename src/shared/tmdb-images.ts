// Constantes de imágenes de TheMovieDB. Módulo puro compartido: main construye rutas de
// caché con ellas, el renderer las usa para URLs remotas (relacionadas, fotos de reparto).

export const IMAGE_BASE = 'https://image.tmdb.org/t/p'
export const POSTER_SIZE = 'w342'
export const BACKDROP_SIZE = 'w1280'
export const THUMB_SIZE = 'w154'
/** Fotos de reparto y pósters de "relacionadas": no se cachean a disco, solo remotas. */
export const PROFILE_SIZE = 'w185'

export function tmdbImageUrl(path: string, size: string): string {
  return `${IMAGE_BASE}/${size}${path}`
}
