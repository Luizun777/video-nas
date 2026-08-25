import type { AppConfig, ServerConfig } from '@shared/types'
import type { StoreIO } from '../io'
import { deepClone, newId } from '../util'
import { JsonStore } from './json-store'

const DEFAULT_SERVER: ServerConfig = {
  id: 'srv_default',
  name: 'NAS principal',
  host: '192.168.0.189',
  share: 'video',
  folders: [
    { path: 'Movies', kind: 'movie' },
    { path: 'TvShow', kind: 'tv' }
  ],
  enabled: true
}

const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  tmdbBearerToken: null,
  language: 'es-MX',
  servers: [DEFAULT_SERVER],
  playbackMode: 'embedded',
  externalPlayerPath: null,
  autoPlayNextEpisode: true,
  autoSkipIntro: true
}

/** Lo que la plataforma aporta al store de configuración. */
export interface ConfigPlatform {
  /** Carpeta de descargas por defecto (desktop: ~/Movies/Video NAS). */
  defaultDownloadsPath: string
  /**
   * Token de desarrollo: seed.config.json (gitignored) en desktop, define de build en
   * Android. Solo se consulta si aún no hay token guardado. Nunca vive en el código.
   */
  loadSeedToken?: () => Promise<string | null>
}

let store: JsonStore<AppConfig>

export function newServerId(): string {
  return newId('srv')
}

export async function initConfigStore(io: StoreIO, platform: ConfigPlatform): Promise<AppConfig> {
  store = new JsonStore<AppConfig>(io, 'config.json', deepClone(DEFAULT_CONFIG))
  const config = await store.load()

  if (!Array.isArray(config.servers) || config.servers.length === 0) {
    config.servers = [deepClone(DEFAULT_SERVER)]
  }
  config.language ||= 'es-MX'
  config.downloadsPath ||= platform.defaultDownloadsPath
  config.playbackMode ||= 'embedded'
  // Con === undefined y no ||=: un false guardado a propósito debe sobrevivir.
  if (config.autoPlayNextEpisode === undefined) config.autoPlayNextEpisode = true
  if (config.autoSkipIntro === undefined) config.autoSkipIntro = true

  let seeded = false
  if (!config.tmdbBearerToken && platform.loadSeedToken) {
    const token = await platform.loadSeedToken()
    if (token) {
      config.tmdbBearerToken = token
      seeded = true
    }
  }

  store.set(config)
  if (seeded) await store.flush()
  return config
}

export function getConfig(): AppConfig {
  return store.get()
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  return store.update((draft) => {
    if (patch.tmdbBearerToken !== undefined) draft.tmdbBearerToken = patch.tmdbBearerToken || null
    if (patch.language !== undefined) draft.language = patch.language
    if (patch.downloadsPath !== undefined && patch.downloadsPath.trim()) {
      draft.downloadsPath = patch.downloadsPath.trim()
    }
    if (patch.playbackMode !== undefined) draft.playbackMode = patch.playbackMode
    if (patch.externalPlayerPath !== undefined) {
      draft.externalPlayerPath = patch.externalPlayerPath || null
    }
    if (patch.autoPlayNextEpisode !== undefined) {
      draft.autoPlayNextEpisode = patch.autoPlayNextEpisode
    }
    if (patch.autoSkipIntro !== undefined) draft.autoSkipIntro = patch.autoSkipIntro
    if (patch.servers !== undefined) {
      draft.servers = patch.servers.map((server) => ({
        ...server,
        id: server.id || newServerId(),
        folders: server.folders.filter((folder) => folder.path.trim().length > 0)
      }))
    }
  })
}

export function getServerById(serverId: string): ServerConfig | undefined {
  return store.get().servers.find((server) => server.id === serverId)
}

export function flushConfig(): Promise<void> {
  return store.flush()
}
