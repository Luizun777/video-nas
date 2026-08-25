import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { MediaKind } from '@shared/types'
import { BACKDROP_SIZE, POSTER_SIZE, downloadImage } from './client'

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
