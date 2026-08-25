import type { ChapterMarks } from '@shared/types'
import { findChapterMarks, parseChaptersFromBuffer } from './ebml-chapters'

/**
 * Solo se leen los primeros megabytes: en un mux normal los capítulos van antes de los
 * datos de video, así que no hace falta (ni conviene) recorrer una película entera por la
 * red desde el NAS.
 */
const SCAN_LIMIT_BYTES = 4 * 1024 * 1024

/** v1 solo entiende Matroska. Otros contenedores devuelven vacío sin intentarlo. */
const SUPPORTED_EXTENSIONS = new Set(['.mkv', '.webm'])

/**
 * Marcas de intro/créditos del archivo. `readHead` lee hasta maxBytes desde el inicio
 * (desktop: fs.open+read; Android: fetch con cabecera Range al puente HTTP local) y
 * devuelve null si no pudo. Cualquier error degrada a {} — los capítulos son opcionales.
 */
export async function readChapterMarks(
  fileName: string,
  readHead: (maxBytes: number) => Promise<Uint8Array | null>
): Promise<ChapterMarks> {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || !SUPPORTED_EXTENSIONS.has(fileName.slice(dot).toLowerCase())) return {}

  try {
    const head = await readHead(SCAN_LIMIT_BYTES)
    if (!head || head.length === 0) return {}
    return findChapterMarks(parseChaptersFromBuffer(head))
  } catch {
    return {}
  }
}
