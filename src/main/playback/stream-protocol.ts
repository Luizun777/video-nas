import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { mimeForPath, parseRange } from '@core/playback/http-range'
import { parseVideoStreamUrl } from '@shared/playback-url'
import { resolveAbsolutePath } from './resolve'

/**
 * Sirve los archivos de video al elemento <video> del renderer. A diferencia del protocolo
 * de imágenes, este SÍ implementa Range: sin 206 Partial Content el <video> no puede
 * buscar dentro de una película de varios GB sin volver a leerla entera.
 */
export function registerVideoFileProtocol(): void {
  protocol.handle('videofile', async (request) => {
    const parsed = parseVideoStreamUrl(request.url)
    if (!parsed) return new Response('URL inválida', { status: 400 })

    const resolved = await resolveAbsolutePath(parsed.itemId, parsed.relPath)
    if ('error' in resolved) return new Response(resolved.error, { status: 404 })

    let fileSize: number
    try {
      fileSize = (await fs.stat(resolved.absPath)).size
    } catch {
      return new Response('No encontrado', { status: 404 })
    }

    const rangeHeader = request.headers.get('range')
    const range = parseRange(rangeHeader, fileSize)

    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' }
      })
    }

    const { start, end } = range ?? { start: 0, end: Math.max(fileSize - 1, 0) }
    const stream = createReadStream(resolved.absPath, { start, end })

    const headers: Record<string, string> = {
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
  })
}
