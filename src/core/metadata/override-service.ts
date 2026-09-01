import type { LibraryItem, MetadataOverride } from '@shared/types'
import type { ImageCacheAdapter } from '../io'
import { getConfig } from '../stores/config-store'
import { flushLibrary, getItem, putItem } from '../stores/library-store'
import { flushOverrides, setOverride } from '../stores/overrides-store'
import { identifyByTmdbId } from '../tmdb/identifier'

/**
 * Aplicar/restaurar correcciones de metadata: la MISMA lógica para Electron y Android
 * (antes vivía duplicada en src/main/ipc.ts y src/mobile/api.ts). "Restaurar" escribe
 * un tombstone `mode:'none'` en vez de borrar la entrada: así la sincronización con el
 * NAS puede propagar el restaurado a otros dispositivos sin que la corrección vieja
 * reviva en el siguiente merge.
 */

export interface OverrideServiceContext {
  images: ImageCacheAdapter
  emitLibrary: () => void
  /** Best-effort: empujar el cambio al archivo compartido del NAS (F15c). */
  onOverrideChanged?: (serverId: string) => void
}

let ctx: OverrideServiceContext | null = null

export function initOverrideService(context: OverrideServiceContext): void {
  ctx = context
}

export async function applyOverrideToItem(
  itemId: string,
  override: MetadataOverride
): Promise<LibraryItem | null> {
  if (!ctx) throw new Error('override-service sin inicializar')
  const item = getItem(itemId)
  if (!item) return null

  const stamped: MetadataOverride = { ...override, setAt: override.setAt || new Date().toISOString() }
  setOverride(itemId, stamped)

  let updated: LibraryItem
  if (stamped.mode === 'file-only') {
    updated = {
      ...item,
      identify: 'file-only',
      tmdb: null,
      posterCache: undefined,
      backdropCache: undefined
    }
  } else {
    const config = getConfig()
    const outcome = await identifyByTmdbId(stamped.mediaType ?? item.kind, stamped.tmdbId!, {
      token: config.tmdbBearerToken,
      language: config.language,
      images: ctx.images
    })
    updated = { ...item, ...outcome, tvDetails: null, extraDetails: null }
  }

  putItem(updated)
  await Promise.all([flushLibrary(), flushOverrides()])
  ctx.emitLibrary()
  ctx.onOverrideChanged?.(item.serverId)
  return updated
}

export async function clearOverrideToAuto(itemId: string): Promise<LibraryItem | null> {
  if (!ctx) throw new Error('override-service sin inicializar')
  const item = getItem(itemId)
  if (!item) return null

  setOverride(itemId, { mode: 'none', setAt: new Date().toISOString() })
  const reset = resetForReidentify(item)
  putItem(reset)
  await Promise.all([flushLibrary(), flushOverrides()])
  ctx.emitLibrary()
  ctx.onOverrideChanged?.(item.serverId)
  return reset
}

/** Deja el item listo para que el siguiente escaneo lo re-identifique desde cero. */
export function resetForReidentify(item: LibraryItem): LibraryItem {
  return {
    ...item,
    identify: 'unidentified',
    tmdb: null,
    tvDetails: null,
    extraDetails: null,
    posterCache: undefined,
    backdropCache: undefined,
    lastLookupAt: undefined,
    lookupKey: undefined
  }
}
