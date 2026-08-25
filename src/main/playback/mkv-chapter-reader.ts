import { promises as fs } from 'node:fs'
import type { ChapterMarks } from '@shared/types'
import { findChapterMarks, parseChaptersFromBuffer } from '@core/playback/ebml-chapters'

/**
 * Solo se leen los primeros megabytes: en un mux normal los capítulos van antes de los
 * datos de video, así que no hace falta (ni conviene) recorrer una película entera por la
 * red desde el NAS.
 */
const SCAN_LIMIT_BYTES = 4 * 1024 * 1024

/** v1 solo entiende Matroska. Otros contenedores devuelven vacío sin intentarlo. */
const SUPPORTED_EXTENSIONS = new Set(['.mkv', '.webm'])

export async function readChapterMarks(absPath: string): Promise<ChapterMarks> {
  const dot = absPath.lastIndexOf('.')
  if (dot < 0 || !SUPPORTED_EXTENSIONS.has(absPath.slice(dot).toLowerCase())) return {}

  try {
    const handle = await fs.open(absPath, 'r')
    try {
      const buffer = Buffer.alloc(SCAN_LIMIT_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, SCAN_LIMIT_BYTES, 0)
      return findChapterMarks(parseChaptersFromBuffer(buffer.subarray(0, bytesRead)))
    } finally {
      await handle.close()
    }
  } catch {
    return {}
  }
}
