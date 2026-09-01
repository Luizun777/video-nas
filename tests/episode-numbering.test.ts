import { describe, expect, it } from 'vitest'
import { parseEpisode } from '../src/core/scanner/name-parser'
import { groupSeries } from '../src/core/scanner/grouper'

/**
 * Numeración de episodios contra los patrones de nombre REALES del NAS (validado
 * archivo a archivo sobre las 31 series, 1919 archivos). Cada caso viene de una serie
 * concreta: si alguien toca el parser, esto avisa antes de que el catálogo se
 * descoloque otra vez.
 */

describe('parseEpisode con nombres reales', () => {
  it.each([
    // [archivo, subcarpetas, temporada, episodio, serie de la que salió]
    ['Los Simpson - 03x05 Homero al diccionario.mkv', [], 3, 5, 'Los Simpson'],
    ['big4x01.mp4', ['Temporada 4'], 4, 1, 'Big Bang Theory'],
    ['big4x15-1.mp4', ['Temporada 4'], 4, 15, 'Big Bang Theory (parte suelta al final)'],
    ['the big bang theory temporada 5 - 01.mp4', [], 1, 1, 'BBT ("temporada 5" no es el episodio)'],
    ['Ranma ½ - 002 - La escuela no es un parque de diversiones.mkv', [], 1, 2, 'Ranma ½'],
    ['Ranma ½ - 155 - La guerra de animadoras parte 1.mkv', [], 1, 155, 'Ranma ½ ("parte 1" no manda)'],
    ['Evangelion 01 - El Ataque Del Angel.mp4', [], 1, 1, 'Evangelion'],
    ['01 - Sakura y el Misterioso Libro Magico.mkv', [], 1, 1, 'Sakura Card Captor'],
    ['02 Golden Boy.mp4', [], 1, 2, 'Golden Boy'],
    ['13. Sabrina in Wonderland.avi', ['Season 7'], 7, 13, 'Sabrina'],
    ['c11 Por la gloria de mi madre.mp4', ['Temporada 1'], 1, 11, 'Aida'],
    ['#10 The Best Christmas Ever.mp4', ['moral-orel-season-1'], 1, 10, 'Moral Orel'],
    ['[Coalgirls]_Serial_Experiments_Lain_07_(1008x720_Blu-Ray_FLAC)_[8160D097].mkv', [], 1, 7, 'Lain'],
    ['[Exiled-Destiny]_Ranma_½_TV_Ep010_(160ECF10).mkv', [], 1, 10, 'Ranma ½ EN'],
    ['[Exiled-Destiny]_Ranma_½_OVA_Ep03_(60C66258).mkv', ['OVA'], 0, 3, 'Ranma ½ EN (OVA = temporada 0)'],
    [
      'Ley y orden Unidad de Víctimas Especiales - 01x02 - Una Vida De Soltera.mp4',
      ['T1'],
      1,
      2,
      'La ley y el orden'
    ]
  ])('%s -> T%iE%i (%s)', (fileName, chain, season, episode) => {
    expect(parseEpisode(fileName, chain as string[])).toEqual({ season, episode })
  })

  it.each([
    ['Sabrina Goes to Rome.avi', 'película de TV, sin número'],
    ['[Coalgirls]_Serial_Experiments_Lain_OP_(1008x720_Blu-Ray_FLAC)_[827F1AF5].mkv', 'opening']
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
  it('Ranma: el 155 va después del 002, no antes', () => {
    const files = [
      'TvShow/Ranma ½ (1989)/Ranma ½ - 155 - La guerra de animadoras parte 1.mkv',
      'TvShow/Ranma ½ (1989)/Ranma ½ - 156 - La guerra de animadoras parte 2.mkv',
      'TvShow/Ranma ½ (1989)/Ranma ½ - 001 - De China llega un extraño.mkv',
      'TvShow/Ranma ½ (1989)/Ranma ½ - 002 - La escuela no es un parque de diversiones.mkv'
    ].map((relPath) => ({ relPath, size: 100 }))

    const [serie] = groupSeries('TvShow', files)
    expect(serie.episodes?.map((e) => e.episode)).toEqual([1, 2, 155, 156])
    expect(serie.episodes?.[0].relPath).toContain('001 - De China')
  })
})
