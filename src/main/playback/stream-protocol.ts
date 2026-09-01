import { createReadStream, promises as fs } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { mimeForPath, parseRange } from '@core/playback/http-range'
import { parseVideoStreamUrl } from '@shared/playback-url'
import { resolveAbsolutePath } from './resolve'
import { convertSubtitleFile, extractEmbeddedSubtitle } from './subtitle-extractor'
import { stopTranscodeSession, takeSessionStream } from './transcode-session'

/**
 * Todo lo que consume el <video> del renderer, por host de videofile://
 *   - stream:    el archivo con soporte Range (206) — sin él no hay seek en archivos de GB.
 *   - subs:      pistas de subtítulos como WebVTT (embebidas via ffmpeg, o .srt externos).
 *   - transcode: el fMP4 de la sesión de transcodificación, como stream NO buscable.
 *
 * El <video> usa crossOrigin="anonymous" (obligatorio para que <track> funcione), y eso
 * vuelve CORS TODAS sus peticiones: cada respuesta —errores incluidos— lleva ACAO.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' }

function deny(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...CORS, ...headers } })
}

async function handleStream(request: Request): Promise<Response> {
  const parsed = parseVideoStreamUrl(request.url)
  if (!parsed) return deny('URL inválida', 400)

  const resolved = await resolveAbsolutePath(parsed.itemId, parsed.relPath)
  if ('error' in resolved) return deny(resolved.error, 404)

  let fileSize: number
  try {
    fileSize = (await fs.stat(resolved.absPath)).size
  } catch {
    return deny('No encontrado', 404)
  }

  const rangeHeader = request.headers.get('range')
  const range = parseRange(rangeHeader, fileSize)

  if (rangeHeader && !range) {
    return deny('', 416, { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' })
  }

  const { start, end } = range ?? { start: 0, end: Math.max(fileSize - 1, 0) }
  const stream = createReadStream(resolved.absPath, { start, end })

  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': mimeForPath(resolved.absPath),
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    // Sin caché a propósito: el mismo item puede pasar del NAS a una copia local
    // descargada a mitad de sesión, y no queremos servir bytes de la fuente anterior.
    'Cache-Control': 'no-store'
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers
  })
}

async function handleSubs(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const itemId = url.searchParams.get('itemId')
  if (!itemId) return deny('URL inválida', 400)
  const relPath = url.searchParams.get('relPath') ?? undefined

  const resolved = await resolveAbsolutePath(itemId, relPath)
  if ('error' in resolved) return deny(resolved.error, 404)

  const streamParam = url.searchParams.get('stream')
  const extParam = url.searchParams.get('ext')

  let vtt: string | null = null
  if (streamParam !== null) {
    vtt = await extractEmbeddedSubtitle(resolved.absPath, Number(streamParam))
  } else if (extParam) {
    // El .srt vive junto al video; se re-resuelve aquí con guardia anti ../
    const videoDir = dirname(resolved.absPath)
    const subPath = normalize(join(videoDir, extParam))
    if (!subPath.startsWith(videoDir)) return deny('Ruta no permitida', 403)
    vtt = await convertSubtitleFile(subPath)
  }

  if (vtt === null) return deny('No se pudo convertir el subtítulo', 404)
  return new Response(vtt, {
    headers: { ...CORS, 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

function handleTranscode(request: Request): Response {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session')
  const stream = sessionId ? takeSessionStream(sessionId) : null
  if (!sessionId || !stream) return deny('Sesión no encontrada', 404)

  // protocol.handle no avisa cuando el consumidor aborta: se envuelve el stdout en un
  // ReadableStream pull-based (contrapresión intacta) cuyo cancel() mata el ffmpeg.
  const nodeWeb = Readable.toWeb(stream) as ReadableStream<Uint8Array>
  const reader = nodeWeb.getReader()
  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel() {
      stopTranscodeSession(sessionId)
    }
  })

  // 200 SIN Accept-Ranges ni Content-Length: así Chromium lo trata como stream en vivo
  // y jamás manda Range (que un pipe no puede satisfacer). El seek lo finge el motor.
  return new Response(wrapped, {
    headers: { ...CORS, 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }
  })
}

export function registerVideoFileProtocol(): void {
  protocol.handle('videofile', (request) => {
    const host = new URL(request.url).host
    if (host === 'subs') return handleSubs(request)
    if (host === 'transcode') return Promise.resolve(handleTranscode(request))
    return handleStream(request)
  })
}
