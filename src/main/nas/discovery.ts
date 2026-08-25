import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { DiscoveredServer } from '@shared/types'
import { isReachable } from './mount-manager'

const exec = promisify(execFile)

const BROWSE_TIMEOUT_MS = 4000
const PROBE_TIMEOUT_MS = 800

/**
 * Instancias anunciadas por Bonjour. `dns-sd` bufferiza su salida cuando no escribe a un
 * TTY, así que se lee en streaming y se mata el proceso al vencer el tiempo.
 */
function browseBonjour(): Promise<string[]> {
  return new Promise((resolve) => {
    const names = new Set<string>()
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('/usr/bin/dns-sd', ['-B', '_smb._tcp', 'local.'], {
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      resolve([])
      return
    }

    const finish = (): void => {
      clearTimeout(timer)
      child.kill('SIGTERM')
      resolve([...names])
    }

    const timer = setTimeout(finish, BROWSE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        // Timestamp  Add  Flags  if  Domain  Type  Instance Name
        const match = line.match(/\bAdd\b\s+\S+\s+\d+\s+\S+\s+_smb\._tcp\.\s+(.+?)\s*$/)
        if (match) names.add(match[1].trim())
      }
    })
    child.once('error', finish)
    child.once('close', () => {
      clearTimeout(timer)
      resolve([...names])
    })
  })
}

/** Vecinos ya presentes en la tabla ARP: no hace barrido de red, solo lee lo conocido. */
async function arpNeighbors(): Promise<string[]> {
  try {
    const { stdout } = await exec('/usr/sbin/arp', ['-a'], { timeout: 5000 })
    const ips = new Set<string>()
    for (const line of stdout.split('\n')) {
      const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/)
      if (!match) continue
      const ip = match[1]
      if (line.includes('incomplete')) continue
      if (ip.endsWith('.255') || ip.startsWith('224.') || ip.startsWith('239.')) continue
      ips.add(ip)
    }
    return [...ips]
  } catch {
    return []
  }
}

async function resolveBonjourHost(instance: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('/usr/bin/dns-sd', ['-L', instance, '_smb._tcp', 'local.'], {
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      resolve(null)
      return
    }
    let host: string | null = null
    const finish = (): void => {
      clearTimeout(timer)
      child.kill('SIGTERM')
      resolve(host)
    }
    const timer = setTimeout(finish, 3000)
    child.stdout?.on('data', (chunk: Buffer) => {
      const match = chunk.toString('utf-8').match(/can be reached at\s+(\S+?):(\d+)/)
      if (match) {
        host = match[1].replace(/\.$/, '')
        finish()
      }
    })
    child.once('error', finish)
    child.once('close', finish)
  })
}

/**
 * Busca servidores SMB en la red local combinando dos fuentes: anuncios Bonjour y
 * vecinos de la tabla ARP que respondan en el puerto 445.
 */
export async function discoverSmbServers(): Promise<DiscoveredServer[]> {
  const found = new Map<string, DiscoveredServer>()

  const [instances, neighbors] = await Promise.all([browseBonjour(), arpNeighbors()])

  const resolved = await Promise.all(
    instances.map(async (instance) => ({ instance, host: await resolveBonjourHost(instance) }))
  )
  for (const entry of resolved) {
    if (!entry.host) continue
    found.set(entry.host.toLowerCase(), { name: entry.instance, host: entry.host })
  }

  const probes = await Promise.all(
    neighbors.map(async (ip) => ({ ip, open: await isReachable(ip, PROBE_TIMEOUT_MS) }))
  )
  for (const probe of probes) {
    if (!probe.open) continue
    if (found.has(probe.ip.toLowerCase())) continue
    found.set(probe.ip.toLowerCase(), { name: probe.ip, host: probe.ip })
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
