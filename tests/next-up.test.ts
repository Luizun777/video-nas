import { describe, it, expect } from 'vitest'
import type { EpisodeEntry, LibraryItem } from '../src/shared/types'
import { decideNextUp, findNextEpisode, sortedEpisodes } from '../src/shared/next-up'

let counter = 0

function makeItem(overrides: Partial<LibraryItem>): LibraryItem {
  counter++
  return {
    id: `srv:Item ${counter}`,
    serverId: 'srv',
    relPath: `Item ${counter}`,
    kind: 'movie',
    parsed: { title: `Item ${counter}` },
    identify: 'auto',
    tmdb: null,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const ep = (season: number, episode: number): EpisodeEntry => ({
  season,
  episode,
  relPath: `TvShow/Serie/${season}x${String(episode).padStart(2, '0')}.mkv`
})

describe('decideNextUp — prioridad episodio > cola > nada', () => {
  it('serie con episodio siguiente gana a la cola aunque no esté vacía', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(1, 1), ep(1, 2)] })
    const enCola = makeItem({})
    const decision = decideNextUp(serie, ep(1, 1).relPath, [enCola])
    expect(decision).toEqual({ kind: 'episode', episode: ep(1, 2) })
  })

  it('último episodio de la serie con cola → sigue la cola', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(1, 1), ep(1, 2)] })
    const enCola = makeItem({})
    const decision = decideNextUp(serie, ep(1, 2).relPath, [enCola])
    expect(decision).toEqual({ kind: 'queue', item: enCola })
  })

  it('último episodio sin cola → nada', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(1, 1)] })
    expect(decideNextUp(serie, ep(1, 1).relPath, [])).toEqual({ kind: 'none' })
  })

  it('película con cola → sigue la cola', () => {
    const peli = makeItem({})
    const enCola = makeItem({})
    expect(decideNextUp(peli, peli.relPath, [enCola])).toEqual({ kind: 'queue', item: enCola })
  })

  it('película sin cola → nada (la UI mostrará la recomendación)', () => {
    const peli = makeItem({})
    expect(decideNextUp(peli, peli.relPath, [])).toEqual({ kind: 'none' })
  })

  it('el item actual encolado se salta: no se recomienda a sí mismo', () => {
    const peli = makeItem({})
    const otra = makeItem({})
    expect(decideNextUp(peli, peli.relPath, [peli, otra])).toEqual({ kind: 'queue', item: otra })
  })

  it('si el item actual es lo único en la cola → nada', () => {
    const peli = makeItem({})
    expect(decideNextUp(peli, peli.relPath, [peli])).toEqual({ kind: 'none' })
  })

  it('cruza de temporada: S1E2 → S2E1 aunque el array venga desordenado', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(2, 1), ep(1, 2), ep(1, 1)] })
    const decision = decideNextUp(serie, ep(1, 2).relPath, [])
    expect(decision).toEqual({ kind: 'episode', episode: ep(2, 1) })
  })

  it('relPath que no existe entre los episodios → nada', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(1, 1)] })
    expect(decideNextUp(serie, 'TvShow/Serie/no-existe.mkv', [])).toEqual({ kind: 'none' })
  })
})

describe('helpers de episodios', () => {
  it('sortedEpisodes ordena por temporada y episodio', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(2, 1), ep(1, 2), ep(1, 1)] })
    expect(sortedEpisodes(serie).map((e) => `${e.season}x${e.episode}`)).toEqual([
      '1x1',
      '1x2',
      '2x1'
    ])
  })

  it('findNextEpisode devuelve null en el último', () => {
    const serie = makeItem({ kind: 'tv', episodes: [ep(1, 1), ep(1, 2)] })
    expect(findNextEpisode(serie, ep(1, 2).relPath)).toBeNull()
  })
})
