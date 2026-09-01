import { describe, expect, it } from 'vitest'
import { parseEpisode } from '../src/core/scanner/name-parser'
import { groupSeries } from '../src/core/scanner/grouper'

/**
 * Numeración de episodios contra los patrones de nombre que aparecen de verdad en un
 * NAS (validado archivo a archivo sobre un catálogo real de ~1900 archivos). Los
 * títulos aquí son genéricos a propósito: lo que importa —y lo que rompía el parser—
 * es la FORMA del nombre, no de qué serie sea.
 */

describe('parseEpisode con patrones reales', () => {
  it.each([
    // [archivo, subcarpetas, temporada, episodio, qué patrón cubre]
    ['Serie Animada - 03x05 Título del capítulo.mkv', [], 3, 5, 'NNxNN clásico'],
    ['abc4x01.mp4', ['Temporada 4'], 4, 1, 'letras pegadas al número, sin frontera de palabra'],
    ['abc4x15-1.mp4', ['Temporada 4'], 4, 15, 'sufijo "-1" al final que NO es el episodio'],
    ['serie de ejemplo temporada 5 - 01.mp4', [], 1, 1, '"temporada 5" no es el número de episodio'],
    ['Serie ½ - 002 - Título del episodio.mkv', [], 1, 2, 'número suelto entre guiones (numeración absoluta)'],
    ['Serie ½ - 155 - Título en dos partes parte 1.mkv', [], 1, 155, '"parte 1" no gana al número real'],
    ['Serie 01 - Título del episodio.mp4', [], 1, 1, 'número tras el nombre de la serie'],
    ['01 - Título del episodio.mkv', [], 1, 1, 'número al principio con guion'],
    ['02 Título del episodio.mp4', [], 1, 2, 'número al principio con espacio'],
    ['13. Título del episodio.avi', ['Season 7'], 7, 13, 'número al principio con punto'],
    ['c11 Título del capítulo.mp4', ['Temporada 1'], 1, 11, 'marcador "c" de capítulo'],
    ['#10 Título del episodio.mp4', ['serie-season-1'], 1, 10, 'marcador "#"'],
    [
      '[Grupo]_Serie_De_Ejemplo_07_(1008x720_Blu-Ray_FLAC)_[8160D097].mkv',
      [],
      1,
      7,
      'número entre guiones bajos, con resolución 1008x720 que no debe confundir'
    ],
    ['[Grupo]_Serie_½_TV_Ep010_(160ECF10).mkv', [], 1, 10, '"Ep010" rodeado de guiones bajos'],
    ['[Grupo]_Serie_½_OVA_Ep03_(60C66258).mkv', ['OVA'], 0, 3, 'carpeta OVA = temporada 0'],
    [
      'Serie Con Nombre Largo Y Descriptivo - 01x02 - Título del episodio.mp4',
      ['T1'],
      1,
      2,
      'NNxNN dentro de un nombre largo'
    ]
  ])('%s -> T%iE%i (%s)', (fileName, chain, season, episode) => {
    expect(parseEpisode(fileName, chain as string[])).toEqual({ season, episode })
  })

  it.each([
    ['Película De Televisión.avi', 'especial sin número'],
    ['[Grupo]_Serie_De_Ejemplo_OP_(1008x720_Blu-Ray_FLAC)_[827F1AF5].mkv', 'opening']
  ])('%s no inventa número (%s)', (fileName) => {
    expect(parseEpisode(fileName, [])).toBeNull()
  })

  it('no confunde año ni resolución con el episodio', () => {
    // Cuatro dígitos no son un episodio; tampoco "1080p" (no queda separador detrás).
    expect(parseEpisode('Serie - 2005 - Piloto.mkv', [])).toBeNull()
    expect(parseEpisode('Serie - 1080p - Piloto.mkv', [])).toBeNull()
  })
})

describe('groupSeries ordena por el número del archivo', () => {
  it('el 155 va después del 002, no antes', () => {
    // El caso que descolocaba una serie entera: el respaldo de "dígitos finales"
    // capturaba el "1" y el "2" de "parte 1"/"parte 2" y los ponía como episodios 1 y 2.
    const files = [
      'TvShow/Serie ½/Serie ½ - 155 - Título en dos partes parte 1.mkv',
      'TvShow/Serie ½/Serie ½ - 156 - Título en dos partes parte 2.mkv',
      'TvShow/Serie ½/Serie ½ - 001 - Primer episodio.mkv',
      'TvShow/Serie ½/Serie ½ - 002 - Segundo episodio.mkv'
    ].map((relPath) => ({ relPath, size: 100 }))

    const [serie] = groupSeries('TvShow', files)
    expect(serie.episodes?.map((e) => e.episode)).toEqual([1, 2, 155, 156])
    expect(serie.episodes?.[0].relPath).toContain('001 - Primer episodio')
  })
})
