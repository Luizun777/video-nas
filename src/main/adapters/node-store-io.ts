import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { StoreIO } from '@core/io'

// Implementación de escritorio: los JSON viven en userData
// (~/Library/Application Support/video-nas/ en macOS, %APPDATA%\video-nas\ en Windows).

const RENAME_ATTEMPTS = 5

function resolvePath(fileName: string): string {
  return join(app.getPath('userData'), fileName)
}

/**
 * En Windows, reemplazar un archivo que otro proceso tiene abierto un instante (antivirus,
 * indexador de búsqueda) falla con EPERM/EBUSY: se reintenta con esperas cortas.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!transient || attempt >= RENAME_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 50))
    }
  }
}

export const nodeStoreIO: StoreIO = {
  async read(fileName) {
    try {
      return await fs.readFile(resolvePath(fileName), 'utf-8')
    } catch {
      return null
    }
  },

  async writeAtomic(fileName, contents) {
    const filePath = resolvePath(fileName)
    const tmp = `${filePath}.tmp`
    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(tmp, contents, 'utf-8')
    await renameWithRetry(tmp, filePath)
  }
}
