import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { ImageCacheAdapter } from '@core/io'
import type { MediaKind } from '@shared/types'
import { BACKDROP_SIZE, IMAGE_BASE, POSTER_SIZE } from '@shared/tmdb-images'

// Mismos nombres de archivo que el desktop (m|t-<tmdbId>-<size>.ext) bajo Data/cache/
// {posters,backdrops}. La descarga es nativa (downloadFile): los bytes no cruzan el
// bridge JS ni pelean con CORS.

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
  const path = `cache/${relative}`

  try {
    const stat = await Filesystem.stat({ path, directory: Directory.Data })
    if (stat.size > 0) return relative
  } catch {
    // no está en caché todavía
  }

  try {
    await Filesystem.downloadFile({
      url: `${IMAGE_BASE}/${size}${tmdbPath}`,
      path,
      directory: Directory.Data,
      recursive: true
    })
    return relative
  } catch {
    // Sin caché: media-src cae a la URL directa de TMDB (enableTmdbDirectFallback).
    return undefined
  }
}

export const capacitorImageCache: ImageCacheAdapter = {
  async ensureReady() {
    await Filesystem.mkdir({ path: 'cache/posters', directory: Directory.Data, recursive: true }).catch(
      () => {}
    )
    await Filesystem.mkdir({
      path: 'cache/backdrops',
      directory: Directory.Data,
      recursive: true
    }).catch(() => {})
  },
  cachePoster: (kind, tmdbId, tmdbPath) => cacheImage(kind, tmdbId, tmdbPath, 'posters', POSTER_SIZE),
  cacheBackdrop: (kind, tmdbId, tmdbPath) =>
    cacheImage(kind, tmdbId, tmdbPath, 'backdrops', BACKDROP_SIZE)
}

/**
 * Base http://localhost/_capacitor_file_/... del directorio de caché, renderizable por
 * el WebView. Se resuelve UNA vez al arrancar porque el resolver de media-src es síncrono.
 */
export async function imageCacheBaseUrl(): Promise<string> {
  const { uri } = await Filesystem.getUri({ path: 'cache', directory: Directory.Data })
  return Capacitor.convertFileSrc(uri)
}
