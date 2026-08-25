import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppConfig, ServerConfig } from '@shared/types'
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

let store: JsonStore<AppConfig>

export function newServerId(): string {
  return `srv_${randomUUID().slice(0, 8)}`
}

/**
 * Lee el token de `seed.config.json` (gitignored) solo en desarrollo y solo si aún no
 * hay token guardado. El token nunca vive en el código fuente.
 */
async function importSeedToken(config: AppConfig): Promise<boolean> {
  if (config.tmdbBearerToken) return false
  const candidates = [
    join(app.getAppPath(), 'seed.config.json'),
    join(process.cwd(), 'seed.config.json')
  ]
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8')
      const parsed = JSON.parse(raw) as { tmdbBearerToken?: string }
      if (parsed.tmdbBearerToken) {
        config.tmdbBearerToken = parsed.tmdbBearerToken
        return true
      }
    } catch {
      // seed.config.json es opcional
    }
  }
  return false
}

export async function initConfigStore(): Promise<AppConfig> {
  store = new JsonStore<AppConfig>('config.json', structuredClone(DEFAULT_CONFIG))
  const config = await store.load()

  if (!Array.isArray(config.servers) || config.servers.length === 0) {
    config.servers = [structuredClone(DEFAULT_SERVER)]
  }
  config.language ||= 'es-MX'
  config.downloadsPath ||= join(app.getPath('videos'), 'Video NAS')
  config.playbackMode ||= 'embedded'
  // Con === undefined y no ||=: un false guardado a propósito debe sobrevivir.
  if (config.autoPlayNextEpisode === undefined) config.autoPlayNextEpisode = true
  if (config.autoSkipIntro === undefined) config.autoSkipIntro = true

  const seeded = await importSeedToken(config)
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
