import type { ChapterMarks, PlayResult } from '@shared/types'
import { setVideoUrlResolver } from '@shared/playback-url'
import { getConfig } from '@core/stores/config-store'
import { getItem } from '@core/stores/library-store'
import { getLocalCopy } from '@core/downloads/download-manager'
import { pickTargetRelPath } from '@core/playback/resolve-target'
import { readChapterMarks } from '@core/playback/chapter-reader'
import { mimeForPath } from '@core/playback/http-range'
import { Nas } from './nas-plugin'

// Reproducción en Android: el <video> del WebView (y VLC en el fallback) consumen el
// puente HTTP local del plugin (127.0.0.1, Range 206). La URL se construye SIN await
// porque videoStreamUrl() se usa directo en <video src>; el puerto+token se piden una
// vez al arrancar.

let bridge: { port: number; token: string } | null = null

export async function initBridge(): Promise<void> {
  bridge = await Nas.getBridgeInfo()
  setVideoUrlResolver((itemId, relPath) => resolveStreamUrl(itemId, relPath))
}

/** Copia local > NAS, igual que resolve.ts del desktop, pero como URL del puente. */
export function resolveStreamUrl(itemId: string, relPath?: string): string {
  if (!bridge) return 'about:blank'
  const item = getItem(itemId)
  if (!item) return 'about:blank'

  const target = pickTargetRelPath(item, relPath)
  const params = new URLSearchParams()

  const local = getLocalCopy(itemId, target)
  if (local) {
    params.set('path', local)
    return `http://127.0.0.1:${bridge.port}/lf/${bridge.token}?${params.toString()}`
  }

  params.set('serverId', item.serverId)
  params.set('path', target)
  return `http://127.0.0.1:${bridge.port}/v/${bridge.token}?${params.toString()}`
}

/** Capítulos MKV: los primeros 4 MiB via fetch+Range contra el propio puente. */
export function chapterMarksFor(itemId: string, relPath?: string): Promise<ChapterMarks> {
  const item = getItem(itemId)
  if (!item) return Promise.resolve({})
  const target = pickTargetRelPath(item, relPath)
  const url = resolveStreamUrl(itemId, target)

  return readChapterMarks(target, async (maxBytes) => {
    const response = await fetch(url, { headers: { Range: `bytes=0-${maxBytes - 1}` } })
    if (response.status !== 206 && response.status !== 200) return null
    return new Uint8Array(await response.arrayBuffer())
  })
}

/** Intent ACTION_VIEW con la URL del puente: VLC/MX decodifican lo que el WebView no. */
export async function playExternalTarget(itemId: string, relPath?: string): Promise<PlayResult> {
  const item = getItem(itemId)
  if (!item) return { ok: false, error: 'No se encontró el título en la biblioteca.' }

  const target = pickTargetRelPath(item, relPath)
  const url = resolveStreamUrl(itemId, target)
  // externalPlayerPath guarda el packageName elegido en Ajustes (o null = selector).
  const packageName = getConfig().externalPlayerPath ?? undefined

  try {
    return await Nas.playExternal({
      url,
      mime: mimeForPath(target),
      title: item.parsed.title,
      packageName
    })
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
