// Géneros de TheMovieDB en español. Es un catálogo estable (movie + tv comparten espacio
// de ids sin colisión), así que se hardcodea en vez de llamar a /genre/movie/list en runtime.

export const GENRE_NAMES: Record<number, string> = {
  // Películas
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familia',
  14: 'Fantasía',
  36: 'Historia',
  27: 'Terror',
  10402: 'Música',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia ficción',
  10770: 'Película de TV',
  53: 'Suspenso',
  10752: 'Bélica',
  37: 'Western',
  // Series (ids exclusivos de tv)
  10759: 'Acción y Aventura',
  10762: 'Infantil',
  10763: 'Noticias',
  10764: 'Reality',
  10765: 'Ciencia ficción y Fantasía',
  10766: 'Telenovela',
  10767: 'Entrevistas',
  10768: 'Guerra y Política'
}

export function genreName(id: number): string | undefined {
  return GENRE_NAMES[id]
}
