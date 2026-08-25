import type { FsAdapter, FsEntry } from '../io'
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
 * Recorre `relRoot` recursivamente vía el FsAdapter y devuelve los archivos de video
 * encontrados, con la ruta relativa al share (no al root) para que el id del item sea
 * estable entre plataformas.
 */
export async function walkVideos(
  fsa: FsAdapter,
  relRoot: string,
  options: WalkOptions = {}
): Promise<ScannedFile[]> {
  const found: ScannedFile[] = []

  async function walk(relDir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    if (options.isCancelled?.()) return

    let entries: FsEntry[]
    try {
      entries = await fsa.readDir(relDir)
    } catch {
      return // permisos, share desconectado a media escaneo, etc.
    }

    for (const entry of entries) {
      if (options.isCancelled?.()) return
      const name = entry.name
      if (name.startsWith('.') || IGNORED_DIRS.has(name)) continue

      const relPath = `${relDir}/${name}`

      if (entry.dir) {
        await walk(relPath, depth + 1)
        continue
      }

      if (!hasVideoExtension(name)) continue
      found.push({ relPath, size: entry.size })
      if (found.length % 25 === 0) options.onProgress?.(found.length)
    }
  }

  await walk(relRoot, 0)
  options.onProgress?.(found.length)
  return found
}
