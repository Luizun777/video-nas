// Módulo PURO: contrato de HTTP Range compartido por el protocolo videofile:// del
// desktop y el puente HTTP local de Android (StreamServer.kt lo replica 1:1 en Kotlin).
// Cualquier cambio aquí debe reflejarse en ambos servidores y en su test.

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
