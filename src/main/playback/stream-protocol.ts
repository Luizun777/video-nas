import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { parseVideoStreamUrl } from '@shared/playback-url'
import { resolveAbsolutePath } from './resolve'

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv'
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Parsea la cabecera Range de HTTP: "bytes=0-1023", "bytes=500-" (abierto por la derecha)
 * y "bytes=-500" (últimos N bytes). Devuelve null si no hay cabecera o es inválida —
 * el llamador distingue ambos casos mirando si la cabecera venía o no.
 *
 * Exportada aparte de su uso para poder testearla sin levantar Electron.
 */
export function parseRange(rangeHeader: string | null, fileSize: number): ByteRange | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null

  const [, startText, endText] = match
  if (startText === '' && endText === '') return null

  let start: number
  let end: number

  if (startText === '') {
    const suffixLength = Number(endText)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(fileSize - suffixLength, 0)
    end = fileSize - 1
  } else {
    start = Number(startText)
    end = endText === '' ? fileSize - 1 : Number(endText)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start > end || start >= fileSize) return null

  return { start, end: Math.min(end, fileSize - 1) }
}

export function mimeForPath(absPath: string): string {
  const dot = absPath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return VIDEO_MIME_BY_EXTENSION[absPath.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

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
