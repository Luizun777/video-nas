import { describe, expect, it } from 'vitest'
import type { StoreIO } from '../src/core/io'
import { initConfigStore, saveConfig } from '../src/core/stores/config-store'

// Antes del refactor a StoreIO este store solo corría dentro de Electron; ahora se
// prueba con un IO en memoria, igual que lo usará el WebView de Android.

function memoryIO(initial: Record<string, string> = {}): { io: StoreIO; files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  return {
    files,
    io: {
      read: async (name) => files.get(name) ?? null,
      writeAtomic: async (name, contents) => {
        files.set(name, contents)
      }
    }
  }
}

const PLATFORM = { defaultDownloadsPath: '/tmp/descargas' }

describe('initConfigStore', () => {
  it('primer arranque: defaults con el NAS de fábrica y sin token', async () => {
    const { io } = memoryIO()
    const config = await initConfigStore(io, PLATFORM)

    expect(config.tmdbBearerToken).toBeNull()
    expect(config.language).toBe('es-MX')
    expect(config.downloadsPath).toBe('/tmp/descargas')
    expect(config.servers).toHaveLength(1)
    expect(config.servers[0].host).toBe('192.168.1.100')
    expect(config.servers[0].share).toBe('video')
  })

  it('un autoSkipIntro=false guardado a propósito sobrevive al init', async () => {
    const saved = {
      version: 1,
      tmdbBearerToken: 'tok',
      language: 'es-MX',
      servers: [{ id: 'srv_x', name: 'N', host: 'h', share: 's', folders: [], enabled: true }],
      playbackMode: 'embedded',
      autoPlayNextEpisode: true,
      autoSkipIntro: false
    }
    const { io } = memoryIO({ 'config.json': JSON.stringify(saved) })
    const config = await initConfigStore(io, PLATFORM)
    expect(config.autoSkipIntro).toBe(false)
  })

  it('siembra el token de desarrollo solo si no hay uno guardado, y persiste', async () => {
    const { io, files } = memoryIO()
    const config = await initConfigStore(io, PLATFORM)
    expect(config.tmdbBearerToken).toBeNull()

    const seeded = await initConfigStore(io, {
      ...PLATFORM,
      loadSeedToken: async () => 'token-de-seed'
    })
    expect(seeded.tmdbBearerToken).toBe('token-de-seed')
    expect(files.get('config.json')).toContain('token-de-seed')

    const noPisa = await initConfigStore(io, {
      ...PLATFORM,
      loadSeedToken: async () => 'otro-token'
    })
    expect(noPisa.tmdbBearerToken).toBe('token-de-seed')
  })

  it('config corrupto no revienta: parte de los defaults', async () => {
    const { io } = memoryIO({ 'config.json': '{esto no es json' })
    const config = await initConfigStore(io, PLATFORM)
    expect(config.servers[0].id).toBe('srv_default')
  })
})

describe('saveConfig', () => {
  it('asigna id a servidores nuevos y poda carpetas vacías', async () => {
    const { io } = memoryIO()
    await initConfigStore(io, PLATFORM)

    const result = saveConfig({
      servers: [
        {
          id: '',
          name: 'Nuevo',
          host: '192.168.0.50',
          share: 'media',
          folders: [
            { path: 'Movies', kind: 'movie' },
            { path: '   ', kind: 'tv' }
          ],
          enabled: true
        }
      ]
    })

    expect(result.servers[0].id).toMatch(/^srv_[0-9a-f]{8}$/)
    expect(result.servers[0].folders).toEqual([{ path: 'Movies', kind: 'movie' }])
  })

  it('una carpeta escrita con \\ (Windows) se guarda con / para que los ids coincidan', async () => {
    const { io } = memoryIO()
    await initConfigStore(io, PLATFORM)

    const result = saveConfig({
      servers: [
        {
          id: 'srv_x',
          name: 'N',
          host: 'h',
          share: 's',
          folders: [{ path: 'Peliculas\\Accion', kind: 'movie' }],
          enabled: true
        }
      ]
    })

    expect(result.servers[0].folders[0].path).toBe('Peliculas/Accion')
  })
})
