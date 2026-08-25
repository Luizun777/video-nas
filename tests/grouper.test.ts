import { describe, it, expect } from 'vitest'
import type { LibraryItem } from '../src/shared/types'
import {
  groupMovies,
  groupSeries,
  mergeDuplicateMovies,
  planTmdbMerges,
  type GroupedItem,
  type ScannedFile
} from '../src/core/scanner/grouper'

const GB = 1024 * 1024 * 1024
const f = (relPath: string, size = 2 * GB): ScannedFile => ({ relPath, size })

describe('groupMovies', () => {
  it('carpeta con un video: el ancla es la carpeta y el título sale del nombre de carpeta', () => {
    const items = groupMovies('Movies', [
      f('Movies/Avatar (2009)/Avatar.2009.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX].mkv')
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      relPath: 'Movies/Avatar (2009)',
      kind: 'movie',
      parsed: { title: 'Avatar', year: 2009 },
      videoRelPath:
        'Movies/Avatar (2009)/Avatar.2009.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX].mkv'
    })
  })

  it('archivo suelto es su propio item', () => {
    const items = groupMovies('Movies', [f('Movies/Amelie (2001).mp4')])
    expect(items[0]).toMatchObject({
      relPath: 'Movies/Amelie (2001).mp4',
      parsed: { title: 'Amelie', year: 2001 },
      videoRelPath: 'Movies/Amelie (2001).mp4'
    })
  })

  it('ignora los subtítulos porque el walker solo pasa videos, y descarta samples', () => {
    const items = groupMovies('Movies', [
      f('Movies/Pelicula (2020)/pelicula.mkv', 4 * GB),
      f('Movies/Pelicula (2020)/sample.mkv', 20 * 1024 * 1024)
    ])
    expect(items).toHaveLength(1)
    expect(items[0].videoRelPath).toBe('Movies/Pelicula (2020)/pelicula.mkv')
  })

  it('descarta extras pequeños frente al video principal', () => {
    const items = groupMovies('Movies', [
      f('Movies/Peli (2020)/peli.mkv', 8 * GB),
      f('Movies/Peli (2020)/entrevista.mp4', 60 * 1024 * 1024)
    ])
    expect(items).toHaveLength(1)
    expect(items[0].parts).toBeUndefined()
  })

  it('carpeta con dos partes del mismo título produce un item con parts', () => {
    const items = groupMovies('Movies', [
      f('Movies/Kill Bill (2003)/Kill Bill Parte 1.mkv', 4 * GB),
      f('Movies/Kill Bill (2003)/Kill Bill Parte 2.mkv', 4 * GB)
    ])
    expect(items).toHaveLength(1)
    expect(items[0].parts).toEqual([
      { label: 'Parte 1', videoRelPath: 'Movies/Kill Bill (2003)/Kill Bill Parte 1.mkv' },
      { label: 'Parte 2', videoRelPath: 'Movies/Kill Bill (2003)/Kill Bill Parte 2.mkv' }
    ])
  })

  it('carpeta con dos películas distintas produce dos items', () => {
    const items = groupMovies('Movies', [
      f('Movies/Pack/Una Pelicula (2001).mkv', 4 * GB),
      f('Movies/Pack/Otra Pelicula (2005).mkv', 4 * GB)
    ])
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.parsed.title).sort()).toEqual(['Otra Pelicula', 'Una Pelicula'])
  })

  it('archivos sueltos multi-parte del mismo título se agrupan (Batman The Long Halloween)', () => {
    const items = groupMovies('Movies', [
      f('Movies/Batman The Long Halloween Parte 1-1.m4v'),
      f('Movies/Batman The Long Halloween Parte 1-2.mp4')
    ])
    expect(items).toHaveLength(1)
    expect(items[0].parsed.title).toBe('Batman The Long Halloween')
    expect(items[0].parts).toHaveLength(2)
  })

  it('duplicado carpeta + archivo suelto: groupMovies por sí solo los deja como 2 items', () => {
    // La fusión entre anclas distintas es responsabilidad de mergeDuplicateMovies, no de
    // groupMovies (que solo procesa un root a la vez). Ver el describe de más abajo.
    const items = groupMovies('Movies', [
      f('Movies/American History X (1998)/video.mkv'),
      f('Movies/American History X (1998).mpg')
    ])
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.relPath).sort()).toEqual([
      'Movies/American History X (1998)',
      'Movies/American History X (1998).mpg'
    ])
  })

  it('ignora archivos fuera de la carpeta raíz configurada', () => {
    expect(groupMovies('Movies', [f('TvShow/Arcane (2021)/Arcane 1x01.mp4')])).toHaveLength(0)
  })
})

describe('groupSeries', () => {
  it('serie con episodios planos NxNN', () => {
    const items = groupSeries('TvShow', [
      f('TvShow/Arcane (2021)/Arcane 1x02.mp4'),
      f('TvShow/Arcane (2021)/Arcane 1x01.mp4'),
      f('TvShow/Arcane (2021)/Arcane 2x01.mp4')
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      relPath: 'TvShow/Arcane (2021)',
      kind: 'tv',
      parsed: { title: 'Arcane', year: 2021 }
    })
    expect(items[0].episodes).toEqual([
      { season: 1, episode: 1, relPath: 'TvShow/Arcane (2021)/Arcane 1x01.mp4' },
      { season: 1, episode: 2, relPath: 'TvShow/Arcane (2021)/Arcane 1x02.mp4' },
      { season: 2, episode: 1, relPath: 'TvShow/Arcane (2021)/Arcane 2x01.mp4' }
    ])
  })

  it('serie con subcarpetas arbitrarias por temporada (TBBT1 / TBBT2)', () => {
    const items = groupSeries('TvShow', [
      f('TvShow/Big Bang Theory/TBBT1/capitulo 01.avi'),
      f('TvShow/Big Bang Theory/TBBT1/capitulo 02.avi'),
      f('TvShow/Big Bang Theory/TBBT2/capitulo 01.avi')
    ])
    expect(items).toHaveLength(1)
    expect(items[0].parsed).toEqual({ title: 'Big Bang Theory' })
    expect(items[0].episodes).toEqual([
      { season: 1, episode: 1, relPath: 'TvShow/Big Bang Theory/TBBT1/capitulo 01.avi' },
      { season: 1, episode: 2, relPath: 'TvShow/Big Bang Theory/TBBT1/capitulo 02.avi' },
      { season: 2, episode: 1, relPath: 'TvShow/Big Bang Theory/TBBT2/capitulo 01.avi' }
    ])
  })

  it('archivos sin número se numeran secuencialmente tras los conocidos', () => {
    const items = groupSeries('TvShow', [
      f('TvShow/Serie/Temporada 1/piloto.mkv'),
      f('TvShow/Serie/Temporada 1/final.mkv')
    ])
    const eps = items[0].episodes!
    expect(eps.map((e) => e.season)).toEqual([1, 1])
    expect(eps.map((e) => e.episode)).toEqual([1, 2])
    // orden alfabético: "final" antes que "piloto"
    expect(eps[0].relPath).toContain('final')
  })

  it('mezcla de episodios numerados y sin numerar no colisiona', () => {
    const items = groupSeries('TvShow', [
      f('TvShow/Serie/Temporada 1/Serie 1x01.mkv'),
      f('TvShow/Serie/Temporada 1/especial.mkv')
    ])
    const eps = items[0].episodes!
    expect(eps).toEqual([
      { season: 1, episode: 1, relPath: 'TvShow/Serie/Temporada 1/Serie 1x01.mkv' },
      { season: 1, episode: 2, relPath: 'TvShow/Serie/Temporada 1/especial.mkv' }
    ])
  })

  it('video suelto en TvShow se vuelve serie de un episodio', () => {
    const items = groupSeries('TvShow', [f('TvShow/Especial navideño.mp4')])
    expect(items).toHaveLength(1)
    expect(items[0].episodes).toHaveLength(1)
    expect(items[0].parsed.title).toBe('Especial navideño')
  })

  it('serie sin videos no genera item', () => {
    expect(groupSeries('TvShow', [])).toHaveLength(0)
  })
})

describe('versiones dentro de una carpeta', () => {
  it('dos copias del mismo título producen versions, no dos items ni partes', () => {
    // Caso real del NAS: "Dreams (2025)" con un mkv de 2 GB y un mp4 de 1 GB.
    const items = groupMovies('Movies', [
      f('Movies/Dreams (2025)/Dreams.2025.1080p-dual-lat.mkv', 2 * GB),
      f('Movies/Dreams (2025)/Dreams_lat.mp4', 1 * GB)
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      relPath: 'Movies/Dreams (2025)',
      parsed: { title: 'Dreams', year: 2025 },
      // se reproduce por defecto la copia más grande
      videoRelPath: 'Movies/Dreams (2025)/Dreams.2025.1080p-dual-lat.mkv'
    })
    expect(items[0].parts).toBeUndefined()
    expect(items[0].versions).toHaveLength(2)
    expect(items[0].versions![0].videoRelPath).toBe(
      'Movies/Dreams (2025)/Dreams.2025.1080p-dual-lat.mkv'
    )
    expect(items[0].versions![1].videoRelPath).toBe('Movies/Dreams (2025)/Dreams_lat.mp4')
  })

  it('las partes numeradas siguen generando parts, sin versions (es 1 sola versión)', () => {
    const items = groupMovies('Movies', [
      f('Movies/Peli (2020)/Peli Parte 1.mkv', 4 * GB),
      f('Movies/Peli (2020)/Peli Parte 2.mkv', 4 * GB)
    ])
    expect(items).toHaveLength(1)
    expect(items[0].parts).toHaveLength(2)
  })

  it('caso mixto: partes + una copia suelta sin numerar producen 2 versiones', () => {
    const items = groupMovies('Movies', [
      f('Movies/Peli (2020)/Peli Parte 1.mkv', 4 * GB),
      f('Movies/Peli (2020)/Peli Parte 2.mkv', 4 * GB),
      f('Movies/Peli (2020)/Peli.mp4', 2 * GB)
    ])
    expect(items).toHaveLength(1)
    expect(items[0].versions).toHaveLength(2)
    const withParts = items[0].versions!.find((v) => v.parts)
    const withoutParts = items[0].versions!.find((v) => !v.parts)
    expect(withParts?.parts).toHaveLength(2)
    expect(withParts?.size).toBe(8 * GB)
    expect(withoutParts?.videoRelPath).toBe('Movies/Peli (2020)/Peli.mp4')
    // La versión con partes (8 GB) es más grande que la suelta (2 GB): va primero.
    expect(items[0].videoRelPath).toBe(withParts?.videoRelPath)
  })
})

describe('mergeDuplicateMovies — fusión entre anclas distintas', () => {
  it('fusiona carpeta + archivo suelto del mismo título en un item con 2 versiones', () => {
    const grouped = groupMovies('Movies', [
      f('Movies/American History X (1998)/video.mkv', 4 * GB),
      f('Movies/American History X (1998).mpg', 700 * 1024 * 1024)
    ])
    expect(grouped).toHaveLength(2) // groupMovies por sí solo no cruza anclas

    const merged = mergeDuplicateMovies(grouped)
    expect(merged).toHaveLength(1)
    expect(merged[0].relPath).toBe('Movies/American History X (1998)') // la carpeta gana
    expect(merged[0].versions).toHaveLength(2)
    expect(merged[0].versions![0].videoRelPath).toBe(
      'Movies/American History X (1998)/video.mkv'
    ) // mayor tamaño primero
    expect(merged[0].absorbedRelPaths).toEqual(['Movies/American History X (1998).mpg'])
  })

  it('la carpeta gana el ancla aunque el archivo suelto sea más grande', () => {
    const folderItem: GroupedItem = {
      relPath: 'Movies/Peli (2020)',
      kind: 'movie',
      parsed: { title: 'Peli', year: 2020 },
      videoRelPath: 'Movies/Peli (2020)/a.mkv',
      versions: [{ label: '', videoRelPath: 'Movies/Peli (2020)/a.mkv', size: 2 * GB }]
    }
    const looseItem: GroupedItem = {
      relPath: 'Movies/Peli (2020).mp4',
      kind: 'movie',
      parsed: { title: 'Peli', year: 2020 },
      videoRelPath: 'Movies/Peli (2020).mp4',
      versions: [{ label: '', videoRelPath: 'Movies/Peli (2020).mp4', size: 4 * GB }]
    }

    const a = mergeDuplicateMovies([folderItem, looseItem])
    const b = mergeDuplicateMovies([looseItem, folderItem])
    expect(a[0].relPath).toBe('Movies/Peli (2020)')
    expect(b[0].relPath).toBe('Movies/Peli (2020)')
  })

  it('no fusiona el mismo título con años distintos', () => {
    const items: GroupedItem[] = [
      {
        relPath: 'Movies/Dune (1984)',
        kind: 'movie',
        parsed: { title: 'Dune', year: 1984 },
        videoRelPath: 'a.mkv',
        versions: [{ label: '', videoRelPath: 'a.mkv', size: 4 * GB }]
      },
      {
        relPath: 'Movies/Dune (2021)',
        kind: 'movie',
        parsed: { title: 'Dune', year: 2021 },
        videoRelPath: 'b.mkv',
        versions: [{ label: '', videoRelPath: 'b.mkv', size: 6 * GB }]
      }
    ]
    expect(mergeDuplicateMovies(items)).toHaveLength(2)
  })

  it('no fusiona con-año contra sin-año', () => {
    const items: GroupedItem[] = [
      {
        relPath: 'Movies/Alguna (2010)',
        kind: 'movie',
        parsed: { title: 'Alguna', year: 2010 },
        videoRelPath: 'a.mkv',
        versions: [{ label: '', videoRelPath: 'a.mkv', size: 1 * GB }]
      },
      {
        relPath: 'Movies/Alguna.mp4',
        kind: 'movie',
        parsed: { title: 'Alguna' },
        videoRelPath: 'Movies/Alguna.mp4',
        versions: [{ label: '', videoRelPath: 'Movies/Alguna.mp4', size: 1 * GB }]
      }
    ]
    expect(mergeDuplicateMovies(items)).toHaveLength(2)
  })

  it('un item sin duplicados pasa intacto (Kill Bill con parts, sin fusión)', () => {
    const [killBill] = groupMovies('Movies', [
      f('Movies/Kill Bill (2003)/Kill Bill Parte 1.mkv', 4 * GB),
      f('Movies/Kill Bill (2003)/Kill Bill Parte 2.mkv', 4 * GB)
    ])
    const merged = mergeDuplicateMovies([killBill])
    expect(merged).toEqual([killBill])
    expect(merged[0].parts).toHaveLength(2)
  })

  it('no toca los items de series', () => {
    const [serie] = groupSeries('TvShow', [f('TvShow/Arcane (2021)/Arcane 1x01.mp4')])
    expect(mergeDuplicateMovies([serie])).toEqual([serie])
  })
})

describe('planTmdbMerges — segunda pasada por identidad de TMDB', () => {
  let counter = 0
  function makeItem(overrides: Partial<LibraryItem> & { relPath: string }): LibraryItem {
    counter++
    return {
      id: `srv_default:${overrides.relPath}`,
      serverId: 'srv_default',
      kind: 'movie',
      parsed: { title: `Title ${counter}` },
      identify: 'auto',
      tmdb: null,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      ...overrides
    }
  }

  const tmdbMatch = (id: number) =>
    ({
      id,
      mediaType: 'movie' as const,
      title: 'X',
      originalTitle: 'X',
      overview: '',
      posterPath: null,
      backdropPath: null,
      releaseDate: null,
      voteAverage: 0,
      genreIds: [],
      matchedAt: '2026-01-01T00:00:00.000Z'
    })

  it('fusiona 3 copias en idiomas distintos que comparten tmdb.id (Bring Her Back)', () => {
    const items = [
      makeItem({
        relPath: 'Movies/Bring Her Back (2025)/Bring.Her.Back.2025.1080p.BluRay.x264.mp4',
        videoRelPath: 'Movies/Bring Her Back (2025)/Bring.Her.Back.2025.1080p.BluRay.x264.mp4',
        primarySize: 2 * GB,
        tmdb: tmdbMatch(1151031)
      }),
      makeItem({
        relPath: 'Movies/Bring Her Back (2025)/Bring Her Back ES.mp4',
        videoRelPath: 'Movies/Bring Her Back (2025)/Bring Her Back ES.mp4',
        primarySize: 1.5 * GB,
        tmdb: tmdbMatch(1151031)
      }),
      makeItem({
        relPath: 'Movies/Bring Her Back (2025)/Haz.que.regrese.2025.1080p-Dual-Lat.mkv',
        videoRelPath: 'Movies/Bring Her Back (2025)/Haz.que.regrese.2025.1080p-Dual-Lat.mkv',
        primarySize: 1.8 * GB,
        tmdb: tmdbMatch(1151031)
      })
    ]
    const plans = planTmdbMerges(items)
    expect(plans).toHaveLength(1)
    expect(plans[0].versions).toHaveLength(3)
    expect(plans[0].versions[0].size).toBe(2 * GB) // orden por tamaño desc
    expect(plans[0].absorbedIds).toHaveLength(2)
    // La etiqueta se genera de verdad (describeVersion), no queda vacía como antes de
    // fusionar: cada versión sintetizada desde videoRelPath+primarySize debe describirse.
    expect(plans[0].versions.every((v) => v.label.length > 0)).toBe(true)
    expect(plans[0].versions[0].label).toContain('BluRay')
  })

  it('fusiona aunque una copia no tenga año y la otra sí (Pulp Fiction)', () => {
    const items = [
      makeItem({
        relPath: 'Movies/Pulp Fiction.mp4',
        parsed: { title: 'Pulp Fiction' },
        videoRelPath: 'Movies/Pulp Fiction.mp4',
        primarySize: 1 * GB,
        tmdb: tmdbMatch(680)
      }),
      makeItem({
        relPath: 'Movies/Pulp Fiction (1994)',
        parsed: { title: 'Pulp Fiction', year: 1994 },
        videoRelPath: 'Movies/Pulp Fiction (1994)/Pulp.Fiction.1994.BluRay.mp4',
        primarySize: 4 * GB,
        tmdb: tmdbMatch(680)
      })
    ]
    const plans = planTmdbMerges(items)
    expect(plans).toHaveLength(1)
    // La carpeta gana el ancla aunque no sea la única con año.
    expect(plans[0].anchorId).toBe('srv_default:Movies/Pulp Fiction (1994)')
    expect(plans[0].versions).toHaveLength(2)
  })

  it('NO fusiona tmdb ids distintos aunque el título mostrado coincida (Carrie 2002 vs 2013)', () => {
    const items = [
      makeItem({ relPath: 'Movies/Carrie (2002).mp4', tmdb: tmdbMatch(7342) }),
      makeItem({ relPath: 'Movies/Carrie (2013).mp4', tmdb: tmdbMatch(133805) })
    ]
    expect(planTmdbMerges(items)).toHaveLength(0)
  })

  it('ignora items sin identificar (unidentified/file-only)', () => {
    const items = [
      makeItem({ relPath: 'Movies/A.mp4', tmdb: null }),
      makeItem({ relPath: 'Movies/B.mp4', tmdb: null })
    ]
    expect(planTmdbMerges(items)).toHaveLength(0)
  })

  it('no toca series', () => {
    const items = [
      makeItem({ relPath: 'TvShow/A', kind: 'tv', tmdb: tmdbMatch(1) }),
      makeItem({ relPath: 'TvShow/B', kind: 'tv', tmdb: tmdbMatch(1) })
    ]
    expect(planTmdbMerges(items)).toHaveLength(0)
  })

  it('no fusiona el mismo tmdb.id entre servidores distintos', () => {
    const items = [
      makeItem({ relPath: 'Movies/A.mp4', tmdb: tmdbMatch(5) }),
      { ...makeItem({ relPath: 'Movies/A.mp4', tmdb: tmdbMatch(5) }), serverId: 'srv_otro' }
    ]
    expect(planTmdbMerges(items)).toHaveLength(0)
  })

  it('ignora items marcados missing', () => {
    const items = [
      makeItem({ relPath: 'Movies/A.mp4', tmdb: tmdbMatch(5) }),
      makeItem({ relPath: 'Movies/B.mp4', tmdb: tmdbMatch(5), missing: true })
    ]
    expect(planTmdbMerges(items)).toHaveLength(0)
  })

  it('un item ya fusionado (con versions propias) las conserva al fusionarse con otro', () => {
    const items = [
      makeItem({
        relPath: 'Movies/Avatar (2009)',
        videoRelPath: 'Movies/Avatar (2009)/4k.mkv',
        versions: [
          { label: '4K', videoRelPath: 'Movies/Avatar (2009)/4k.mkv', size: 8 * GB },
          { label: '1080p', videoRelPath: 'Movies/Avatar (2009)/1080p.mp4', size: 3 * GB }
        ],
        tmdb: tmdbMatch(19995)
      }),
      makeItem({
        relPath: 'Movies/Avatar.mp4',
        videoRelPath: 'Movies/Avatar.mp4',
        primarySize: 1 * GB,
        tmdb: tmdbMatch(19995)
      })
    ]
    const plans = planTmdbMerges(items)
    expect(plans).toHaveLength(1)
    expect(plans[0].versions).toHaveLength(3)
    expect(plans[0].anchorId).toBe('srv_default:Movies/Avatar (2009)')
  })
})
