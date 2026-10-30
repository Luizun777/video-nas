import { createReadStream, promises as fs } from 'node:fs'
import { join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { app } from 'electron'
import type { MediaKind } from '@shared/types'
import type { ImageCacheAdapter } from '@core/io'
import { BACKDROP_SIZE, POSTER_SIZE, downloadImage } from '@core/tmdb/client'

export function cacheRoot(): string {
  return join(app.getPath('userData'), 'cache')
}

export async function ensureCacheDirs(): Promise<void> {
  await fs.mkdir(join(cacheRoot(), 'posters'), { recursive: true })
  await fs.mkdir(join(cacheRoot(), 'backdrops'), { recursive: true })
}

export function absoluteCachePath(relative: string): string {
  return join(cacheRoot(), relative)
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/** Sirve un archivo del caché (relativo a cacheRoot): mediacache:// y el servidor LAN. */
export async function serveCacheFile(relative: string): Promise<Response> {
  const root = cacheRoot()
  const absolute = normalize(join(root, relative))

  if (!absolute.startsWith(root)) {
    return new Response('Ruta no permitida', { status: 403 })
  }

  try {
    await fs.access(absolute)
  } catch {
    return new Response('No encontrado', { status: 404 })
  }

  const extension = absolute.slice(absolute.lastIndexOf('.')).toLowerCase()
  const stream = createReadStream(absolute)
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000'
    }
  })
}

/**
 * Descarga la imagen si no está ya en el caché y devuelve su ruta relativa
 * (la que consume el protocolo `mediacache://` en el renderer).
 */
async function cacheImage(
  kind: MediaKind,
  tmdbId: number,
  tmdbPath: string | null,
  folder: 'posters' | 'backdrops',
  size: string
): Promise<string | undefined> {
  if (!tmdbPath) return undefined

  const extension = tmdbPath.slice(tmdbPath.lastIndexOf('.')) || '.jpg'
  const fileName = `${kind === 'movie' ? 'm' : 't'}-${tmdbId}-${size}${extension}`
  const relative = `${folder}/${fileName}`
  const absolute = absoluteCachePath(relative)

  try {
    const stat = await fs.stat(absolute)
    if (stat.size > 0) return relative
  } catch {
    // no está en caché todavía
  }

  const buffer = await downloadImage(tmdbPath, size)
  if (!buffer || buffer.length === 0) return undefined

  await fs.mkdir(join(cacheRoot(), folder), { recursive: true })
  const tmp = `${absolute}.tmp`
  await fs.writeFile(tmp, buffer)
  await fs.rename(tmp, absolute)
  return relative
}

export function cachePoster(
  kind: MediaKind,
  tmdbId: number,
  posterPath: string | null
): Promise<string | undefined> {
  return cacheImage(kind, tmdbId, posterPath, 'posters', POSTER_SIZE)
}

export function cacheBackdrop(
  kind: MediaKind,
  tmdbId: number,
  backdropPath: string | null
): Promise<string | undefined> {
  return cacheImage(kind, tmdbId, backdropPath, 'backdrops', BACKDROP_SIZE)
}

/** Adapter que consumen el escáner y el identificador de core. */
export const desktopImageCache: ImageCacheAdapter = {
  ensureReady: ensureCacheDirs,
  cachePoster,
  cacheBackdrop
}
