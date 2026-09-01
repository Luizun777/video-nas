import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FsAdapter, FsEntry } from '@core/io'

/**
 * FsAdapter de escritorio: la raíz es el punto de montaje del share en /Volumes.
 * Los symlinks se tratan como archivos (stat sigue el enlace), igual que el walker
 * original: un symlink a directorio NO se recorre.
 */
export function createNodeFs(mountPoint: string): FsAdapter {
  return {
    async readDir(relPath) {
      const absDir = join(mountPoint, relPath)
      const dirents = await fs.readdir(absDir, { withFileTypes: true })
      const entries: FsEntry[] = []

      for (const dirent of dirents) {
        if (dirent.isDirectory()) {
          entries.push({ name: dirent.name, dir: true, size: 0 })
          continue
        }
        if (!dirent.isFile() && !dirent.isSymbolicLink()) continue
        try {
          const stat = await fs.stat(join(absDir, dirent.name))
          entries.push({ name: dirent.name, dir: false, size: stat.size })
        } catch {
          // Desapareció entre readdir y stat: se omite, igual que hacía el walker.
        }
      }
      return entries
    },

    async readFile(relPath) {
      try {
        return new Uint8Array(await fs.readFile(join(mountPoint, relPath)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },

    async writeFile(relPath, data) {
      const absPath = join(mountPoint, relPath)
      await fs.mkdir(dirname(absPath), { recursive: true })
      const tmpPath = `${absPath}.tmp`
      await fs.writeFile(tmpPath, data)
      await fs.rename(tmpPath, absPath)
    }
  }
}
