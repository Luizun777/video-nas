import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import type { ServerConfig, ServerStatus } from '@shared/types'

const exec = promisify(execFile)

const PORT_CHECK_TIMEOUT_MS = 4000
const MOUNT_POLL_INTERVAL_MS = 2000
const MOUNT_TIMEOUT_MS = 60_000

export interface SmbMount {
  host: string
  share: string
  mountPoint: string
}

/**
 * Parsea la salida de `mount` buscando montajes smbfs.
 * Formato macOS: `//usuario@192.168.1.100/video on /Volumes/video (smbfs, ...)`
 */
export function parseSmbMounts(mountOutput: string): SmbMount[] {
  const mounts: SmbMount[] = []
  for (const line of mountOutput.split('\n')) {
    if (!line.includes('smbfs')) continue
    const match = line.match(/^\/\/(?:([^@/]+)@)?([^/]+)\/([^\s]+)\s+on\s+(.+?)\s+\(/)
    if (!match) continue
    mounts.push({
      host: decodeURIComponent(match[2]),
      share: decodeURIComponent(match[3]),
      mountPoint: match[4]
    })
  }
  return mounts
}

/** Quita el sufijo mDNS y normaliza para comparar hosts. */
function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\._smb\._tcp\.local\.?$/, '')
    .replace(/\.local\.?$/, '')
    .replace(/\.$/, '')
}

async function resolveIp(host: string): Promise<string | null> {
  if (net.isIP(host)) return host
  try {
    const result = await lookup(host)
    return result.address
  } catch {
    return null
  }
}

async function hostsMatch(mountHost: string, configHost: string): Promise<boolean> {
  const a = normalizeHost(mountHost)
  const b = normalizeHost(configHost)
  if (a === b) return true
  // El montaje puede usar el hostname y la config la IP (o viceversa).
  const [ipA, ipB] = await Promise.all([resolveIp(a), resolveIp(b)])
  return ipA !== null && ipA === ipB
}

/** Devuelve el punto de montaje real del servidor, o null si no está montado. */
export async function getMountPoint(server: ServerConfig): Promise<string | null> {
  let output: string
  try {
    const result = await exec('/sbin/mount', [], { timeout: 5000 })
    output = result.stdout
  } catch {
    return null
  }

  const shareTarget = server.share.toLowerCase()
  for (const mount of parseSmbMounts(output)) {
    if (mount.share.toLowerCase() !== shareTarget) continue
    if (await hostsMatch(mount.host, server.host)) return mount.mountPoint
  }
  return null
}

/** Comprueba que el puerto SMB responda antes de intentar montar. */
export function isReachable(host: string, timeoutMs = PORT_CHECK_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(445, host)
  })
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Asegura que el share esté montado.
 *
 * 1. ¿Ya montado? (match por host + share, devuelve el punto de montaje real, que puede
 *    ser /Volumes/video-1 tras un remontaje)
 * 2. Pre-check del puerto 445: si no responde, se marca offline sin lanzar diálogos.
 * 3. `open smb://host/share` dispara el diálogo/llavero de macOS y se espera al montaje.
 */
export async function ensureMounted(
  server: ServerConfig,
  opts: { allowMountPrompt?: boolean } = {}
): Promise<ServerStatus> {
  if (!server.enabled) {
    return { serverId: server.id, state: 'disabled' }
  }

  const existing = await getMountPoint(server)
  if (existing) {
    return { serverId: server.id, state: 'online', mountPoint: existing }
  }

  const reachable = await isReachable(server.host)
  if (!reachable) {
    return {
      serverId: server.id,
      state: 'offline',
      message: `No se pudo contactar a ${server.host} en el puerto SMB (445).`
    }
  }

  if (opts.allowMountPrompt === false) {
    return {
      serverId: server.id,
      state: 'offline',
      message: 'El servidor responde pero el share no está montado.'
    }
  }

  try {
    await exec('/usr/bin/open', [`smb://${server.host}/${server.share}`], { timeout: 10_000 })
  } catch {
    return {
      serverId: server.id,
      state: 'offline',
      message: `No se pudo abrir smb://${server.host}/${server.share}`
    }
  }

  const deadline = Date.now() + MOUNT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(MOUNT_POLL_INTERVAL_MS)
    const mountPoint = await getMountPoint(server)
    if (mountPoint) return { serverId: server.id, state: 'online', mountPoint }
  }

  return {
    serverId: server.id,
    state: 'offline',
    message: 'Se agotó el tiempo de espera al montar el share.'
  }
}

/**
 * Resuelve la ruta absoluta actual de un archivo dado su servidor y ruta relativa.
 * Compartida entre la reproducción (ipc.ts) y las descargas (downloads/download-manager.ts)
 * para que ambas resuelvan el punto de montaje de la misma forma.
 */
export async function resolveNasPath(
  server: ServerConfig,
  relPath: string
): Promise<{ absPath: string } | { error: string }> {
  const mountPoint = await getMountPoint(server)
  if (!mountPoint) {
    return { error: `${server.name} no está conectado. Conéctalo desde Ajustes e inténtalo de nuevo.` }
  }
  const absPath = join(mountPoint, relPath)
  if (!existsSync(absPath)) {
    return { error: `El archivo ya no existe en el NAS:\n${relPath}` }
  }
  return { absPath }
}
