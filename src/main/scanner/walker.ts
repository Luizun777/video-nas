import { promises as fs, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { hasVideoExtension } from './name-parser'
import type { ScannedFile } from './grouper'

/** Carpetas de metadatos de NAS y del sistema que no aportan nada al catálogo. */
const IGNORED_DIRS = new Set([
  '@eaDir',
  '#recycle',
  '#snapshot',
  '.Trashes',
  '.Spotlight-V100',
  '.fseventsd',
  '.TemporaryItems',
  'lost+found',
  'Subs',
  'Subtitles',
  'Subtitulos'
])

const MAX_DEPTH = 8

export interface WalkOptions {
  /** Se consulta entre directorios para poder cancelar un escaneo largo. */
  isCancelled?: () => boolean
  onProgress?: (filesFound: number) => void
}

/**
 * Recorre `absRoot` recursivamente y devuelve los archivos de video encontrados,
 * con la ruta relativa al share (no al root) para que el id del item sea estable.
 */
export async function walkVideos(
  absRoot: string,
  relRoot: string,
  options: WalkOptions = {}
): Promise<ScannedFile[]> {
  const found: ScannedFile[] = []

  async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    if (options.isCancelled?.()) return

    let entries: Dirent[]
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return // permisos, share desmontado a media escaneo, etc.
    }

    for (const entry of entries) {
      if (options.isCancelled?.()) return
      const name = entry.name
      if (name.startsWith('.') || IGNORED_DIRS.has(name)) continue

      const absPath = join(absDir, name)
      const relPath = `${relDir}/${name}`

      if (entry.isDirectory()) {
        await walk(absPath, relPath, depth + 1)
        continue
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      if (!hasVideoExtension(name)) continue

      let size = 0
      try {
        size = (await fs.stat(absPath)).size
      } catch {
        continue
      }
      found.push({ relPath, size })
      if (found.length % 25 === 0) options.onProgress?.(found.length)
    }
  }

  await walk(absRoot, relRoot, 0)
  options.onProgress?.(found.length)
  return found
}
