import { describe, it, expect } from 'vitest'
import {
  cleanTitle,
  parseEpisode,
  parseSeriesFolder,
  inferSeasonFromFolder,
  hasVideoExtension,
  normalizeForCompare,
  formatSize,
  extractQualityTags,
  describeVersion
} from '../src/main/scanner/name-parser'

describe('cleanTitle — casos reales del NAS', () => {
  it('archivo suelto con año normal', () => {
    expect(cleanTitle('Amelie (2001).mp4')).toMatchObject({ title: 'Amelie', year: 2001 })
  })

  it('tolera espacio antes del paréntesis de cierre: "300 (2006 ).avi"', () => {
    expect(cleanTitle('300 (2006 ).avi')).toMatchObject({ title: '300', year: 2006 })
  })

  it('archivo sin año', () => {
    const r = cleanTitle('Apocalypto.mp4')
    expect(r.title).toBe('Apocalypto')
    expect(r.year).toBeUndefined()
  })

  it('release name con año suelto y tags: corta todo tras el año', () => {
    expect(
      cleanTitle('Avatar.2009.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX].mkv')
    ).toMatchObject({ title: 'Avatar', year: 2009 })
  })

  it('título que empieza con un número: el año del paréntesis gana', () => {
    expect(cleanTitle('2001 odisea del espacio (1968)')).toMatchObject({
      title: '2001 odisea del espacio',
      year: 1968
    })
  })

  it('conserva acentos del título', () => {
    expect(cleanTitle('Ahí está el detalle (1940).mpg')).toMatchObject({
      title: 'Ahí está el detalle',
      year: 1940
    })
  })

  it('etiqueta de edición entre paréntesis no ensucia el título', () => {
    expect(cleanTitle('Avatar (2009) (EXTENDED)')).toMatchObject({ title: 'Avatar', year: 2009 })
  })

  it('poda "4K Ultra HD Latino Dual"', () => {
    expect(
      cleanTitle('Battle Angel la última guerrera (2019) 4K Ultra HD Latino Dual')
    ).toMatchObject({ title: 'Battle Angel la última guerrera', year: 2019 })
  })

  it('detecta número de parte', () => {
    const r = cleanTitle('Batman The Long Halloween Parte 1-1.m4v')
    expect(r.title).toBe('Batman The Long Halloween')
    expect(r.part).toBe(1)
  })

  it('segunda parte del mismo título', () => {
    const r = cleanTitle('Batman The Long Halloween Parte 1-2.mp4')
    expect(r.title).toBe('Batman The Long Halloween')
    expect(r.part).toBe(1)
  })

  it('carpeta de película con año', () => {
    expect(cleanTitle('American History X (1998)')).toMatchObject({
      title: 'American History X',
      year: 1998
    })
  })

  it('título que es solo un año no se queda vacío', () => {
    const r = cleanTitle('2012.mp4')
    expect(r.title).toBe('2012')
  })

  it('título largo con guiones y sin año', () => {
    expect(cleanTitle('Avatar Aang, El último Maestro Aire.mp4').title).toBe(
      'Avatar Aang, El último Maestro Aire'
    )
  })
})

describe('parseSeriesFolder', () => {
  it('serie con año', () => {
    expect(parseSeriesFolder('Arcane (2021)')).toEqual({ title: 'Arcane', year: 2021 })
  })

  it('serie sin año', () => {
    expect(parseSeriesFolder('Big Bang Theory')).toEqual({ title: 'Big Bang Theory' })
  })

  it('serie con espacio raro antes del cierre', () => {
    expect(parseSeriesFolder('Kono Subarashii Sekai ni Shukufuku wo! (2016 )')).toEqual({
      title: 'Kono Subarashii Sekai ni Shukufuku wo!',
      year: 2016
    })
  })
})

describe('parseEpisode', () => {
  it('patrón NxNN plano', () => {
    expect(parseEpisode('Arcane 1x01.mp4')).toEqual({ season: 1, episode: 1 })
  })

  it('patrón NxNN de segunda temporada', () => {
    expect(parseEpisode('Arcane 2x09.mp4')).toEqual({ season: 2, episode: 9 })
  })

  it('patrón SxxEyy', () => {
    expect(parseEpisode('Serie S02E05.mkv')).toEqual({ season: 2, episode: 5 })
  })

  it('patrón S01.E03 con separador', () => {
    expect(parseEpisode('Show.S01.E03.1080p.mkv')).toEqual({ season: 1, episode: 3 })
  })

  it('temporada desde carpeta arbitraria terminada en dígito (TBBT1)', () => {
    expect(parseEpisode('episodio 03.avi', ['TBBT1'])).toEqual({ season: 1, episode: 3 })
  })

  it('temporada desde TBBT2', () => {
    expect(parseEpisode('capitulo 12.avi', ['TBBT2'])).toEqual({ season: 2, episode: 12 })
  })

  it('carpeta "Temporada 2"', () => {
    expect(parseEpisode('cap 04.mkv', ['Temporada 2'])).toEqual({ season: 2, episode: 4 })
  })

  it('carpeta "Season 3"', () => {
    expect(parseEpisode('ep07.mp4', ['Season 3'])).toEqual({ season: 3, episode: 7 })
  })

  it('sin pista de temporada asume la 1', () => {
    expect(parseEpisode('05.mp4')).toEqual({ season: 1, episode: 5 })
  })

  it('el patrón del archivo gana sobre la carpeta', () => {
    expect(parseEpisode('Serie 3x02.mkv', ['Temporada 9'])).toEqual({ season: 3, episode: 2 })
  })

  it('devuelve null si no hay ningún número', () => {
    expect(parseEpisode('intro.mkv')).toBeNull()
  })
})

describe('inferSeasonFromFolder', () => {
  it.each([
    ['Temporada 1', 1],
    ['Season 2', 2],
    ['T3', 3],
    ['S04', 4],
    ['TBBT5', 5],
    ['Temp. 6', 6]
  ])('%s -> %i', (folder, expected) => {
    expect(inferSeasonFromFolder(folder)).toBe(expected)
  })

  it('carpeta sin dígitos', () => {
    expect(inferSeasonFromFolder('Extras')).toBeNull()
  })
})

describe('utilidades', () => {
  it('reconoce extensiones de video', () => {
    expect(hasVideoExtension('a.mkv')).toBe(true)
    expect(hasVideoExtension('a.srt')).toBe(false)
    expect(hasVideoExtension('a.MP4')).toBe(true)
  })

  it('normaliza para comparar sin acentos', () => {
    expect(normalizeForCompare('Ahí está el detalle')).toBe('ahi esta el detalle')
    expect(normalizeForCompare('Amélie!')).toBe('amelie')
  })
})

describe('formatSize', () => {
  it('por encima de 1 GB usa GB con un decimal', () => {
    expect(formatSize(15.3 * 1024 ** 3)).toBe('15.3 GB')
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })

  it('por debajo de 1 GB usa MB redondeado', () => {
    expect(formatSize(820 * 1024 ** 2)).toBe('820 MB')
    expect(formatSize(50 * 1024 ** 2)).toBe('50 MB')
  })
})

describe('extractQualityTags', () => {
  it('detecta resolución, fuente y códec de un release real', () => {
    expect(
      extractQualityTags('Avatar.2009.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX].mkv')
    ).toEqual(['4K', 'BluRay', 'x265'])
  })

  it('detecta idioma cuando no hay fuente ni códec', () => {
    expect(
      extractQualityTags('Battle Angel la última guerrera (2019) 4K Ultra HD Latino Dual')
    ).toEqual(['4K', 'Latino'])
  })

  it('caso simple resolución + idioma', () => {
    expect(extractQualityTags('Pelicula 1080p Latino.mp4')).toEqual(['1080p', 'Latino'])
  })

  it('archivo sin ningún tag reconocible', () => {
    expect(extractQualityTags('Amelie (2001).mp4')).toEqual([])
  })

  it('reconoce h.264 con punto igual que h264', () => {
    expect(extractQualityTags('Pelicula h.264 720p.mkv')).toEqual(['720p', 'x264'])
  })

  it('respeta el orden de categorías, no el de aparición en el archivo', () => {
    // "Latino" aparece antes que "1080p" en el nombre, pero resolución va primero.
    expect(extractQualityTags('Pelicula Latino 1080p.mp4')).toEqual(['1080p', 'Latino'])
  })

  it('separa tags pegados por guion sin espacios (caso real del NAS)', () => {
    // "American.History.X.1998.1080P-Dual-Lat.mkv": tras normalizar puntos a espacios,
    // "1080P-Dual-Lat" llega como un solo token — hay que partirlo por guion.
    expect(extractQualityTags('American.History.X.1998.1080P-Dual-Lat.mkv')).toEqual([
      '1080p',
      'Dual'
    ])
  })

  it('no rompe compuestos reales con guion (blu-ray, web-dl)', () => {
    expect(extractQualityTags('Pelicula.2020.Blu-ray.x264.mkv')).toEqual(['BluRay', 'x264'])
    expect(extractQualityTags('Pelicula.2020.WEB-DL.x265.mkv')).toEqual(['WEB-DL', 'x265'])
  })
})

describe('describeVersion', () => {
  it('con tags: "tags · CONTENEDOR · tamaño"', () => {
    expect(
      describeVersion('Avatar.2009.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX].mkv', 15.3 * 1024 ** 3)
    ).toBe('4K BluRay x265 · MKV · 15.3 GB')
  })

  it('sin tags: "CONTENEDOR · tamaño"', () => {
    expect(describeVersion('Amelie (2001).mp4', 1.2 * 1024 ** 3)).toBe('MP4 · 1.2 GB')
  })
})
