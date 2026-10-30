import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import { EVENTS, IPC } from '@shared/ipc-channels'
import type { AppConfig, LanServerConfig, LanServerInfo } from '@shared/types'
import { getConfig } from '@core/stores/config-store'
import { handleStream, handleTranscode } from '../playback/stream-protocol'
import { serveCacheFile } from '../tmdb/image-cache'
import { getHandler, onBroadcast, type LanCaller } from './rpc-registry'

/**
 * Versión web: un servidor HTTP dentro de la app de escritorio para abrir el catálogo
 * desde cualquier navegador de la LAN (http://IP-de-la-Mac:puerto). Sirve:
 *   /            el bundle web (out/web, vite.config.web.ts)
 *   /api/rpc/:ch los MISMOS handlers de ipc.ts (rpc-registry), solo los de la allowlist
 *   /api/events  los eventos de main por SSE
 *   /media/...   video con Range, el fMP4 del transcode y las portadas cacheadas
 *
 * Sin cuentas ni contraseña: solo acepta clientes de redes privadas y Host de LAN
 * (contra DNS rebinding). Cualquiera en tu red ve el catálogo; los ajustes sensibles
 * (token, servidores, carpetas) nunca salen ni se cambian desde aquí.
 */

export const DEFAULT_LAN_PORT = 8787

/** Lo que un navegador de la LAN puede llamar. Lo demás es de la Mac (diálogos, Finder, descargas). */
const ALLOWED_CHANNELS = new Set<string>([
  IPC.getConfig,
  IPC.saveConfig,
  IPC.getLibrary,
  IPC.getServerStatuses,
  IPC.refreshServerStatuses,
  IPC.startScan,
  IPC.cancelScan,
  IPC.getScanProgress,
  IPC.tmdbSearch,
  IPC.applyOverride,
  IPC.clearOverride,
  IPC.getTvDetails,
  IPC.getExtraDetails,
  IPC.getChapterMarks,
  IPC.setIntroMark,
  IPC.getQueue,
  IPC.addToQueue,
  IPC.removeFromQueue,
  IPC.clearQueue,
  IPC.shiftQueue,
  IPC.purgeMissing,
  IPC.getPlaybackProgress,
  IPC.setPlaybackProgress,
  IPC.clearPlaybackProgress,
  IPC.listSubtitleFiles,
  IPC.getSubtitleVtt,
  IPC.getPreviewFrame,
  IPC.probeMedia,
  IPC.startTranscode,
  IPC.stopTranscode
])

/** Eventos que se reenvían por SSE (descargas y ventana separada no existen en la web). */
const FORWARDED_EVENTS = new Set<string>([
  EVENTS.scanProgress,
  EVENTS.libraryChanged,
  EVENTS.serverStatuses,
  EVENTS.queue
])

/** El navegador solo sabe que hay token, nunca cuál. */
export const LAN_TOKEN_MASK = 'configurado-en-la-app'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2'
}

const MAX_RPC_BODY = 1024 * 1024

let server: Server | null = null
let runningPort: number | null = null
let lastError: string | undefined
const sseClients = new Set<ServerResponse>()
let unsubscribeBroadcast: (() => void) | null = null

function lanConfig(): LanServerConfig {
  return getConfig().lanServer ?? { enabled: false, port: DEFAULT_LAN_PORT }
}

function webRoot(): string {
  return join(app.getAppPath(), 'out', 'web')
}

// ---- Filtros de acceso ----------------------------------------------------

function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address
  if (ip === '::1' || ip === '127.0.0.1') return true
  if (isIP(ip) === 6) return /^f[cd]|^fe[89ab]/i.test(ip) // ULA y link-local
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT: Tailscale
  )
}

/** Contra DNS rebinding: una web ajena que apunte su dominio a la IP de la Mac trae su Host. */
function isLanHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const host = hostHeader.replace(/^\[(.*)\](:\d+)?$/, '$1').replace(/:\d+$/, '')
  if (isIP(host)) return true
  if (!host.includes('.')) return true // localhost, mac-mini…
  return /\.(local|lan|home|internal|ts\.net)$/i.test(host)
}

/** Un POST desde otra página (CSRF) trae su propio Origin. */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// ---- Configuración que ve el navegador -----------------------------------

function configForLan(config: AppConfig): AppConfig {
  return {
    ...config,
    tmdbBearerToken: config.tmdbBearerToken ? LAN_TOKEN_MASK : null,
    servers: config.servers.map(({ username: _u, password: _p, domain: _d, ...server }) => server),
    downloadsPath: undefined,
    externalPlayerPath: null,
    // El navegador siempre usa su reproductor integrado: el externo abriría en la Mac.
    playbackMode: 'embedded',
    lanServer: undefined
  }
}

/** Desde la LAN solo se tocan preferencias de reproducción, nunca token ni servidores. */
function lanConfigPatch(patch: Partial<AppConfig> | undefined): Partial<AppConfig> {
  const allowed: Partial<AppConfig> = {}
  if (typeof patch?.autoPlayNextEpisode === 'boolean') allowed.autoPlayNextEpisode = patch.autoPlayNextEpisode
  if (typeof patch?.autoSkipIntro === 'boolean') allowed.autoSkipIntro = patch.autoSkipIntro
  return allowed
}

// ---- Respuestas -------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(json)
}

/** Vuelca un Response de los handlers de protocolo; si el navegador corta, se cancela su body. */
async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)
  if (!response.body) {
    res.end()
    return
  }
  // pipeline destruye el Readable al cerrarse la respuesta, y eso cancela el
  // ReadableStream: en el transcode, su cancel() mata el ffmpeg.
  await pipeline(Readable.fromWeb(response.body as never), res).catch(() => {})
}

function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  if (req.headers.range) headers.set('range', req.headers.range)
  return new Request(`http://lan${req.url ?? '/'}`, { headers })
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_RPC_BODY) throw new Error('Petición demasiado grande')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

// ---- Rutas ------------------------------------------------------------------

async function handleRpc(req: IncomingMessage, res: ServerResponse, channel: string): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Solo POST' })
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido' })
  const handler = getHandler(channel)
  if (!ALLOWED_CHANNELS.has(channel) || !handler) {
    return sendJson(res, 404, { error: `No disponible en la versión web: ${channel}` })
  }

  let args: unknown[]
  try {
    const raw = await readBody(req)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) throw new Error('args debe ser un arreglo')
    // JSON convierte undefined en null; los handlers distinguen relPath ausente con undefined.
    args = parsed.map((arg) => (arg === null ? undefined : arg))
  } catch (error) {
    return sendJson(res, 400, { error: (error as Error).message })
  }

  if (channel === IPC.saveConfig) args = [lanConfigPatch(args[0] as Partial<AppConfig>)]

  const caller: LanCaller = { lanClient: req.socket.remoteAddress ?? 'desconocido' }
  try {
    let result = await handler(caller, ...args)
    if (channel === IPC.getConfig || channel === IPC.saveConfig) result = configForLan(result as AppConfig)
    sendJson(res, 200, { result: result ?? null })
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message })
  }
}

function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  })
  res.write(': conectado\n\n')
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
}

function forwardEvent(channel: string, payload: unknown): void {
  if (!FORWARDED_EVENTS.has(channel) || sseClients.size === 0) return
  const frame = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const client of sseClients) client.write(frame)
}

async function handleStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const root = webRoot()
  // HashRouter: cualquier ruta que no sea un archivo es la app.
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  let absolute = normalize(join(root, relative))
  if (!absolute.startsWith(root)) return sendJson(res, 403, { error: 'Ruta no permitida' })

  const stat = await fs.stat(absolute).catch(() => null)
  if (!stat?.isFile()) absolute = join(root, 'index.html')

  const indexStat = absolute.endsWith('index.html') ? await fs.stat(absolute).catch(() => null) : stat
  if (!indexStat) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Falta el bundle web: corre "npm run build:web" y reabre la app.')
    return
  }

  const isIndex = absolute.endsWith('index.html')
  res.writeHead(200, {
    'Content-Type': MIME_BY_EXTENSION[extname(absolute).toLowerCase()] ?? 'application/octet-stream',
    // Los assets de Vite llevan hash en el nombre; el index no, y debe pedir siempre los nuevos.
    'Cache-Control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable'
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  await pipeline(createReadStream(absolute), res).catch(() => {})
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isPrivateAddress(req.socket.remoteAddress) || !isLanHost(req.headers.host)) {
    return sendJson(res, 403, { error: 'Solo disponible dentro de tu red local' })
  }

  const { pathname } = new URL(req.url ?? '/', 'http://lan')

  if (pathname.startsWith('/api/rpc/')) return handleRpc(req, res, decodeURIComponent(pathname.slice(9)))
  if (pathname === '/api/events') return handleEvents(req, res)
  if (pathname === '/media/stream') return sendWebResponse(res, await handleStream(toWebRequest(req)))
  if (pathname === '/media/transcode') return sendWebResponse(res, handleTranscode(toWebRequest(req)))
  if (pathname.startsWith('/media/cache/')) {
    return sendWebResponse(res, await serveCacheFile(decodeURIComponent(pathname.slice(13))))
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método no permitido' })
  return handleStatic(req, res, pathname)
}

// ---- Ciclo de vida -------------------------------------------------------

export function stopLanServer(): void {
  for (const client of sseClients) client.end()
  sseClients.clear()
  unsubscribeBroadcast?.()
  unsubscribeBroadcast = null
  server?.close()
  // Las conexiones de video abiertas no dejarían cerrar el servidor nunca.
  server?.closeAllConnections()
  server = null
  runningPort = null
}

/** Arranca, reinicia (cambio de puerto) o apaga según config.lanServer. */
export function startLanServerFromConfig(): void {
  const { enabled, port } = lanConfig()
  if (!enabled) {
    stopLanServer()
    lastError = undefined
    return
  }
  if (server && runningPort === port) return
  stopLanServer()

  lastError = undefined
  const next = createServer((req, res) => {
    route(req, res).catch((error: Error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message })
      else res.destroy()
    })
  })
  next.on('error', (error: NodeJS.ErrnoException) => {
    lastError =
      error.code === 'EADDRINUSE'
        ? `El puerto ${port} ya lo usa otro programa. Prueba con otro.`
        : error.message
    if (server === next) {
      server = null
      runningPort = null
    }
  })
  next.listen(port, '0.0.0.0', () => {
    runningPort = port
  })
  server = next
  runningPort = port
  unsubscribeBroadcast = onBroadcast(forwardEvent)
}

function lanAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}

export function getLanServerInfo(): LanServerInfo {
  const { port } = lanConfig()
  const running = server !== null && runningPort !== null && !lastError
  return {
    running,
    port,
    urls: running ? lanAddresses().map((ip) => `http://${ip}:${port}`) : [],
    error: lastError
  }
}
