import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { StoreIO } from '@core/io'

// Implementación de escritorio: los JSON viven en userData
// (~/Library/Application Support/video-nas/), igual que siempre.

function resolvePath(fileName: string): string {
  return join(app.getPath('userData'), fileName)
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
    await fs.rename(tmp, filePath)
  }
}
