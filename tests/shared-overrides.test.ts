import { describe, expect, it } from 'vitest'
import {
  buildRemoteUpdate,
  keyForRelPath,
  parseSharedOverrides,
  planRemoteApplies,
  serializeSharedOverrides,
  TOMBSTONE_TTL_MS
} from '../src/core/metadata/shared-overrides'
import type { MetadataOverride, SharedOverridesFile } from '../src/shared/types'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const T3 = '2026-03-01T00:00:00.000Z'

function remoteWith(entries: SharedOverridesFile['entries']): SharedOverridesFile {
  return { version: 1, entries }
}

function local(itemId: string, override?: MetadataOverride) {
  return { itemId, override }
}

describe('keyForRelPath', () => {
  it('el NFD de macOS y el NFC de Android dan la MISMA clave', () => {
    const nfd = 'Pelis/Amélie (2001)' // e + combining acute (macOS)
    const nfc = 'Pelis/Amélie (2001)' // é precompuesta (Android)
    expect(keyForRelPath(nfd)).toBe(keyForRelPath(nfc))
  })
})

describe('parse/serialize', () => {
  it('round-trip y tolerancia a basura', () => {
    const file = remoteWith({ Pelis: { mode: 'tmdb', tmdbId: 603, setAt: T1 } })
    expect(parseSharedOverrides(serializeSharedOverrides(file))).toEqual(file)
    expect(parseSharedOverrides(null).entries).toEqual({})
    expect(parseSharedOverrides('{no json').entries).toEqual({})
    expect(parseSharedOverrides('{"version":9}').entries).toEqual({})
  })
})

describe('planRemoteApplies', () => {
  const key = keyForRelPath('Pelis/Matrix')

  it('lo remoto más nuevo gana; lo local más nuevo se queda', () => {
    const remote = remoteWith({ [key]: { mode: 'tmdb', tmdbId: 603, setAt: T2 } })

    const sinLocal = planRemoteApplies(remote, new Map([[key, local('srv:Pelis/Matrix')]]))
    expect(sinLocal).toHaveLength(1)
    expect(sinLocal[0].itemId).toBe('srv:Pelis/Matrix')

    const localViejo = planRemoteApplies(
      remote,
      new Map([[key, local('srv:Pelis/Matrix', { mode: 'tmdb', tmdbId: 1, setAt: T1 })]])
    )
    expect(localViejo).toHaveLength(1)

    const localNuevo = planRemoteApplies(
      remote,
      new Map([[key, local('srv:Pelis/Matrix', { mode: 'tmdb', tmdbId: 1, setAt: T3 })]])
    )
    expect(localNuevo).toHaveLength(0)
  })

  it('un tombstone remoto más nuevo aplica sobre el override local', () => {
    const remote = remoteWith({ [key]: { mode: 'none', setAt: T3 } })
    const applies = planRemoteApplies(
      remote,
      new Map([[key, local('srv:Pelis/Matrix', { mode: 'tmdb', tmdbId: 603, setAt: T2 })]])
    )
    expect(applies).toHaveLength(1)
    expect(applies[0].entry.mode).toBe('none')
  })

  it('un override más nuevo que el tombstone remoto NO se pisa', () => {
    const remote = remoteWith({ [key]: { mode: 'none', setAt: T1 } })
    const applies = planRemoteApplies(
      remote,
      new Map([[key, local('srv:Pelis/Matrix', { mode: 'tmdb', tmdbId: 603, setAt: T2 })]])
    )
    expect(applies).toHaveLength(0)
  })

  it('claves sin item local se ignoran (huérfanas de otras carpetas)', () => {
    const remote = remoteWith({ 'Otra/Cosa': { mode: 'tmdb', tmdbId: 1, setAt: T1 } })
    expect(planRemoteApplies(remote, new Map())).toHaveLength(0)
  })
})

describe('buildRemoteUpdate', () => {
  const now = new Date(T3).getTime()

  it('empuja lo pendiente más nuevo, respeta lo remoto más nuevo, preserva huérfanas', () => {
    const remote = remoteWith({
      A: { mode: 'tmdb', tmdbId: 1, setAt: T2 },
      Huerfana: { mode: 'tmdb', tmdbId: 9, setAt: T1 }
    })
    const { file, changed } = buildRemoteUpdate(
      remote,
      [
        { key: 'A', entry: { mode: 'tmdb', tmdbId: 2, setAt: T1 } }, // más viejo: no pisa
        { key: 'B', entry: { mode: 'file-only', setAt: T2 } } // nuevo: entra
      ],
      now
    )
    expect(changed).toBe(true)
    expect(file.entries.A.tmdbId).toBe(1)
    expect(file.entries.B.mode).toBe('file-only')
    expect(file.entries.Huerfana).toBeTruthy()
  })

  it('sin cambios reales, changed=false (no se reescribe el NAS en cada escaneo)', () => {
    const remote = remoteWith({ A: { mode: 'tmdb', tmdbId: 1, setAt: T2 } })
    const { changed } = buildRemoteUpdate(
      remote,
      [{ key: 'A', entry: { mode: 'tmdb', tmdbId: 2, setAt: T1 } }],
      now
    )
    expect(changed).toBe(false)
  })

  it('poda tombstones más viejos que el TTL y conserva los recientes', () => {
    const viejo = new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString()
    const remote = remoteWith({
      Viejo: { mode: 'none', setAt: viejo },
      Reciente: { mode: 'none', setAt: T2 }
    })
    const { file, changed } = buildRemoteUpdate(remote, [], now)
    expect(changed).toBe(true)
    expect(file.entries.Viejo).toBeUndefined()
    expect(file.entries.Reciente).toBeTruthy()
  })
})
