import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Espejo TS del plugin Kotlin (android/.../NasPlugin.kt). Cualquier cambio aquí debe
// reflejarse allá: este archivo ES el contrato JS↔nativo.

export interface NasEntry {
  name: string
  dir: boolean
  size: number
}

export interface DownloadProgressEvent {
  key: string
  bytesDone: number
  totalBytes: number
  state: 'downloading' | 'done' | 'error'
  /** En cancelaciones deliberadas vale exactamente DOWNLOAD_CANCELLED ("CANCELLED"). */
  error?: string
}

export interface NasPluginApi {
  /** Credenciales y shares en memoria del plugin; invalida conexiones si cambiaron. */
  configure(options: {
    servers: {
      id: string
      host: string
      share: string
      username?: string
      password?: string
      domain?: string
    }[]
  }): Promise<{ ok: boolean }>

  /** TCP 445 → sesión SMB → share. 'auth' = credenciales rechazadas. */
  probe(options: { serverId: string }): Promise<{ state: 'online' | 'offline' | 'auth'; message?: string }>

  /** Listado con tamaños incluidos (SMBJ los trae en el propio listado). */
  listDir(options: { serverId: string; path: string }): Promise<{ entries: NasEntry[] }>

  statFile(options: { serverId: string; path: string }): Promise<{ exists: boolean; dir: boolean; size: number }>

  /** Puerto efímero del puente HTTP local y token de sesión (SecureRandom, por proceso). */
  getBridgeInfo(): Promise<{ port: number; token: string }>

  download(options: { key: string; serverId: string; path: string; localPath: string }): Promise<{ started: boolean }>
  cancelDownload(options: { key: string }): Promise<{ ok: boolean }>

  renameFile(options: { from: string; to: string }): Promise<{ ok: boolean }>
  deleteLocalFile(options: { path: string }): Promise<{ ok: boolean }>
  ensureDir(options: { path: string }): Promise<{ ok: boolean }>
  exists(options: { path: string }): Promise<{ exists: boolean }>
  freeSpace(): Promise<{ bytes: number }>
  /** getExternalFilesDir(MOVIES): carpeta de descargas de la app, sin permisos extra. */
  localVideosDir(): Promise<{ path: string }>

  listVideoApps(): Promise<{ apps: { packageName: string; label: string }[] }>
  playExternal(options: {
    url: string
    mime: string
    title?: string
    packageName?: string
  }): Promise<{ ok: boolean; error?: string }>

  keepScreenOn(options: { on: boolean }): Promise<{ ok: boolean }>

  addListener(
    eventName: 'downloadProgress',
    cb: (event: DownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>
}

export const Nas = registerPlugin<NasPluginApi>('Nas')
