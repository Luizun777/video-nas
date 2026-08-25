// URL "virtual" del protocolo videofile://, la única forma en que el renderer se refiere a
// un archivo de video. No lleva rutas de disco: solo el id del item y la ruta relativa, que
// el proceso main revalida contra la biblioteca antes de servir nada.
//
// Se usa URLSearchParams (y no encodeURIComponent a mano) porque itemId contiene ':' y
// relPath contiene '/' y acentos: así el escapado y desescapado son simétricos siempre.

const STREAM_URL_BASE = 'videofile://stream'

export function videoStreamUrl(itemId: string, relPath?: string): string {
  const params = new URLSearchParams({ itemId })
  if (relPath) params.set('relPath', relPath)
  return `${STREAM_URL_BASE}?${params.toString()}`
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
