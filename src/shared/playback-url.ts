// URL "virtual" del protocolo videofile://, la única forma en que el renderer se refiere a
// un archivo de video. No lleva rutas de disco: solo el id del item y la ruta relativa, que
// el proceso main revalida contra la biblioteca antes de servir nada.
//
// Se usa URLSearchParams (y no encodeURIComponent a mano) porque itemId contiene ':' y
// relPath contiene '/' y acentos: así el escapado y desescapado son simétricos siempre.

const STREAM_URL_BASE = 'videofile://stream'

export type VideoUrlResolver = (itemId: string, relPath?: string) => string

// Default: el protocolo videofile:// de Electron. Android registra un resolver que
// apunta al puente HTTP local (http://127.0.0.1:puerto) al arrancar. Es síncrono a
// propósito: se usa directo en <video src>.
let videoUrlResolver: VideoUrlResolver = (itemId, relPath) => {
  const params = new URLSearchParams({ itemId })
  if (relPath) params.set('relPath', relPath)
  return `${STREAM_URL_BASE}?${params.toString()}`
}

export function setVideoUrlResolver(next: VideoUrlResolver): void {
  videoUrlResolver = next
}

export function videoStreamUrl(itemId: string, relPath?: string): string {
  return videoUrlResolver(itemId, relPath)
}

export function parseVideoStreamUrl(url: string): { itemId: string; relPath?: string } | null {
  try {
    const parsed = new URL(url)
    const itemId = parsed.searchParams.get('itemId')
    if (!itemId) return null
    const relPath = parsed.searchParams.get('relPath')
    return relPath ? { itemId, relPath } : { itemId }
  } catch {
    return null
  }
}

// --- URLs solo-desktop (el motor nativo de Android no las usa) -------------
// Mismo esquema videofile:// con otros hosts: "subs" sirve WebVTT (pista embebida
// convertida con ffmpeg, o un .srt externo) y "transcode" el fMP4 de la sesión.

/** source.stream = índice global de la pista embebida; source.ext = ruta del .srt
 *  RELATIVA al directorio del video. */
export function subtitleTrackUrl(
  itemId: string,
  relPath: string | undefined,
  source: { stream: number } | { ext: string }
): string {
  const params = new URLSearchParams({ itemId })
  if (relPath) params.set('relPath', relPath)
  if ('stream' in source) params.set('stream', String(source.stream))
  else params.set('ext', source.ext)
  return `videofile://subs?${params.toString()}`
}

export function transcodeSessionUrl(sessionId: string): string {
  return `videofile://transcode?${new URLSearchParams({ session: sessionId }).toString()}`
}
