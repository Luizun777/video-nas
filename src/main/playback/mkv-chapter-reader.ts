import { promises as fs } from 'node:fs'
import type { ChapterMarks } from '@shared/types'
import { readChapterMarks as readChapterMarksWith } from '@core/playback/chapter-reader'

/** Shim de escritorio: la lectura de la cabecera del archivo con fs, el resto en core. */
export function readChapterMarks(absPath: string): Promise<ChapterMarks> {
  return readChapterMarksWith(absPath, async (maxBytes) => {
    const handle = await fs.open(absPath, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  })
}
