import { describe, expect, it } from 'vitest'
import { decideNextUp, pickRandomEpisode } from '../src/shared/next-up'
import type { LibraryItem } from '../src/shared/types'

function serie(episodios: number): LibraryItem {
  return {
    id: 'srv:Serie',
    serverId: 'srv',
    relPath: 'Serie',
    kind: 'tv',
    parsed: { title: 'Serie' },
    identify: 'auto',
    tmdb: null,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    episodes: Array.from({ length: episodios }, (_, i) => ({
      season: 1,
      episode: i + 1,
      relPath: `Serie/e${i + 1}.mkv`
    }))
  }
}

describe('pickRandomEpisode', () => {
  it('nunca devuelve el episodio que se está viendo', () => {
    const item = serie(5)
    // Se recorre todo el rango del sorteo: ninguna posición puede caer en el actual.
    for (let i = 0; i < 20; i++) {
      const elegido = pickRandomEpisode(item, 'Serie/e3.mkv', () => i / 20)
      expect(elegido?.relPath).not.toBe('Serie/e3.mkv')
    }
  })

  it('con random=~1 no se sale del array', () => {
    expect(pickRandomEpisode(serie(4), '', () => 0.999999)?.episode).toBe(4)
  })

  it('con un solo episodio lo repite en vez de cortar', () => {
    expect(pickRandomEpisode(serie(1), 'Serie/e1.mkv', () => 0)?.episode).toBe(1)
  })

  it('sin episodios devuelve null', () => {
    expect(pickRandomEpisode({ ...serie(0), episodes: [] }, '')).toBeNull()
  })
})

describe('decideNextUp en modo aleatorio', () => {
  it('sortea en vez de ir al siguiente en orden', () => {
    const item = serie(10)
    const enOrden = decideNextUp(item, 'Serie/e1.mkv', [])
    expect(enOrden).toMatchObject({ kind: 'episode' })
    expect(enOrden.kind === 'episode' && enOrden.episode.episode).toBe(2)

    const azar = decideNextUp(item, 'Serie/e1.mkv', [], { shuffle: true, random: () => 0.75 })
    expect(azar.kind === 'episode' && azar.episode.episode).toBe(8)
  })

  it('en el último episodio sigue habiendo siguiente (por eso existe el modo)', () => {
    const item = serie(6)
    expect(decideNextUp(item, 'Serie/e6.mkv', []).kind).toBe('none')
    expect(decideNextUp(item, 'Serie/e6.mkv', [], { shuffle: true, random: () => 0 }).kind).toBe(
      'episode'
    )
  })
})
