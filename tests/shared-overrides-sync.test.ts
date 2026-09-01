import { describe, expect, it } from 'vitest'
import type { FsAdapter, StoreIO } from '../src/core/io'
import type { LibraryItem, ServerConfig } from '../src/shared/types'
import { initLibraryStore, getLibrary, putItem } from '../src/core/stores/library-store'
import { initOverridesStore, getOverride, setOverride } from '../src/core/stores/overrides-store'
import {
  pullSharedOverrides,
  pushSharedOverrides
} from '../src/core/metadata/shared-overrides-sync'
import { SHARED_OVERRIDES_PATH } from '../src/core/metadata/shared-overrides'

// Simulación del flujo real Mac ↔ tablet: dos "dispositivos" (stores re-inicializados)
// que comparten el mismo share (un FsAdapter en memoria). El detalle crítico es que la
// Mac guarda relPaths en NFD y la tablet en NFC: el archivo compartido debe unirlos.

function memoryIO(): StoreIO {
  const files = new Map<string, string>()
  return {
    read: async (name) => files.get(name) ?? null,
    writeAtomic: async (name, contents) => {
      files.set(name, contents)
    }
  }
}

/** El "NAS": un share en memoria compartido entre ambos dispositivos. */
function memoryShare(): { fs: FsAdapter; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    fs: {
      readDir: async () => [],
      readFile: async (relPath) => files.get(relPath) ?? null,
      writeFile: async (relPath, data) => {
        files.set(relPath, data)
      }
    }
  }
}

const NFD_REL = 'Pelis/Amélie (2001)' // macOS: e + acento combinante
const NFC_REL = 'Pelis/Amélie (2001)' // Android: é precompuesta

// Fechas relativas a hoy: con fechas fijas viejas, la poda de tombstones (TTL 180
// días) se comería el tombstone recién empujado y el test mentiría.
const T_CORRECCION = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
const T_RESTAURADO = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()

function serverConfig(id: string): ServerConfig {
  return { id, name: 'NAS', host: 'nas.local', share: 'video', folders: [], enabled: true }
}

function fakeItem(serverId: string, relPath: string): LibraryItem {
  return {
    id: `${serverId}:${relPath}`,
    serverId,
    relPath,
    kind: 'movie',
    parsed: { title: 'Amélie' },
    identify: 'auto',
    tmdb: {
      id: 999,
      mediaType: 'movie',
      title: 'Equivocada',
      originalTitle: 'Wrong',
      overview: '',
      posterPath: null,
      backdropPath: null,
      releaseDate: '1999-01-01',
      voteAverage: 5,
      genreIds: [],
      matchedAt: '2026-01-01T00:00:00.000Z'
    },
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z'
  }
}

async function bootDevice(serverId: string, relPath: string): Promise<void> {
  await initLibraryStore(memoryIO())
  await initOverridesStore(memoryIO())
  putItem(fakeItem(serverId, relPath))
}

describe('sincronización Mac (NFD) ↔ tablet (NFC) vía el share', () => {
  it('el override viaja entre ids incompatibles y el tombstone lo deshace', async () => {
    const share = memoryShare()
    const macServer = serverConfig('srv_mac')
    const tabletServer = serverConfig('srv_tab')

    // 1. En la Mac: corrección manual, aún sin sincronizar.
    await bootDevice('srv_mac', NFD_REL)
    setOverride(`srv_mac:${NFD_REL}`, {
      mode: 'tmdb',
      tmdbId: 194,
      mediaType: 'movie',
      setAt: T_CORRECCION
    })
    await pushSharedOverrides(macServer, share.fs)

    const written = share.files.get(SHARED_OVERRIDES_PATH)
    expect(written).toBeTruthy()
    const parsed = JSON.parse(new TextDecoder().decode(written))
    // La clave del archivo es NFC aunque la Mac guarde NFD.
    expect(parsed.entries[NFC_REL.normalize('NFC')]).toMatchObject({ mode: 'tmdb', tmdbId: 194 })
    // Y quedó marcada como sincronizada (no se re-empuja en cada escaneo).
    expect(getOverride(`srv_mac:${NFD_REL}`)?.syncedAt).toBe(T_CORRECCION)

    // 2. En la tablet: el escaneo absorbe la corrección de la Mac.
    await bootDevice('srv_tab', NFC_REL)
    await pullSharedOverrides(tabletServer, share.fs, [NFC_REL])

    const tabletOverride = getOverride(`srv_tab:${NFC_REL}`)
    expect(tabletOverride).toMatchObject({ mode: 'tmdb', tmdbId: 194 })
    expect(tabletOverride?.syncedAt).toBe(tabletOverride?.setAt)

    // 3. En la tablet: "restaurar automático" → tombstone al share.
    setOverride(`srv_tab:${NFC_REL}`, { mode: 'none', setAt: T_RESTAURADO })
    await pushSharedOverrides(tabletServer, share.fs)

    // 4. En la Mac: el tombstone deshace la corrección y resetea el item.
    await bootDevice('srv_mac', NFD_REL)
    setOverride(`srv_mac:${NFD_REL}`, {
      mode: 'tmdb',
      tmdbId: 194,
      mediaType: 'movie',
      setAt: T_CORRECCION,
      syncedAt: T_CORRECCION
    })
    await pullSharedOverrides(macServer, share.fs, [NFD_REL])

    expect(getOverride(`srv_mac:${NFD_REL}`)?.mode).toBe('none')
    const item = getLibrary().items[`srv_mac:${NFD_REL}`]
    expect(item.identify).toBe('unidentified')
    expect(item.tmdb).toBeNull()
  })

  it('share de solo lectura: lo pendiente sobrevive para el próximo escaneo', async () => {
    const readOnly: FsAdapter = {
      readDir: async () => [],
      readFile: async () => null,
      writeFile: async () => {
        throw new Error('EROFS')
      }
    }
    await bootDevice('srv_mac', NFD_REL)
    setOverride(`srv_mac:${NFD_REL}`, {
      mode: 'tmdb',
      tmdbId: 194,
      setAt: T_CORRECCION
    })
    await pushSharedOverrides(serverConfig('srv_mac'), readOnly)
    // Sin syncedAt: sigue pendiente, y no reventó nada.
    expect(getOverride(`srv_mac:${NFD_REL}`)?.syncedAt).toBeUndefined()
  })
})
