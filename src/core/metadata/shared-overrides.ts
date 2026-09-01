import type { MetadataOverride, SharedOverrideEntry, SharedOverridesFile } from '@shared/types'

// Formato y merge del archivo compartido de correcciones en el NAS. Puro a propósito:
// la lectura/escritura vive en shared-overrides-sync.ts (usa FsAdapter); aquí solo hay
// decisiones, testeables con vitest.

/** Dentro de un dotdir: el walker ignora todo lo que empieza por punto, así que el
 *  catálogo nunca ve esta carpeta como contenido. */
export const SHARED_OVERRIDES_PATH = '.video-nas/overrides.json'

/** Un tombstone más viejo que esto ya hizo su trabajo en todos los dispositivos vivos. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000

/**
 * Clave del archivo compartido: relPath en NFC y sin serverId. macOS entrega NFD y
 * Android NFC; normalizar aquí hace que ambos dispositivos hablen de la misma película
 * aunque sus itemIds locales difieran (y esos ids NO deben cambiar).
 */
export function keyForRelPath(relPath: string): string {
  return relPath.normalize('NFC')
}

export function parseSharedOverrides(text: string | null): SharedOverridesFile {
  if (!text) return { version: 1, entries: {} }
  try {
    const parsed = JSON.parse(text) as SharedOverridesFile
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || !parsed.entries) {
      return { version: 1, entries: {} }
    }
    return { version: 1, entries: parsed.entries }
  } catch {
    return { version: 1, entries: {} }
  }
}

export function serializeSharedOverrides(file: SharedOverridesFile): string {
  return JSON.stringify(file, null, 2)
}

export interface RemoteApply {
  itemId: string
  entry: SharedOverrideEntry
}

/**
 * Qué entradas remotas deben aplicarse localmente: las que tienen un item en este
 * dispositivo y son MÁS NUEVAS que el override local (o no hay override local).
 * Las claves sin item local (huérfanas: otro folder, otra carpeta compartida) se
 * ignoran aquí y se preservan al escribir (buildRemoteUpdate parte del remoto).
 */
export function planRemoteApplies(
  remote: SharedOverridesFile,
  localByKey: Map<string, { itemId: string; override?: MetadataOverride }>
): RemoteApply[] {
  const applies: RemoteApply[] = []
  for (const [key, entry] of Object.entries(remote.entries)) {
    const local = localByKey.get(key)
    if (!local) continue
    if (local.override && local.override.setAt >= entry.setAt) continue
    applies.push({ itemId: local.itemId, entry })
  }
  return applies
}

export interface PendingPush {
  key: string
  entry: SharedOverrideEntry
}

/**
 * Fusiona lo pendiente local sobre el archivo remoto (newest-wins por setAt) y poda
 * tombstones viejos. `changed` evita reescrituras idénticas en cada escaneo.
 */
export function buildRemoteUpdate(
  remote: SharedOverridesFile,
  pending: PendingPush[],
  nowMs: number
): { file: SharedOverridesFile; changed: boolean } {
  const entries: Record<string, SharedOverrideEntry> = { ...remote.entries }
  let changed = false

  for (const push of pending) {
    const existing = entries[push.key]
    if (existing && existing.setAt >= push.entry.setAt) continue
    entries[push.key] = push.entry
    changed = true
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (entry.mode !== 'none') continue
    const age = nowMs - new Date(entry.setAt).getTime()
    if (Number.isFinite(age) && age > TOMBSTONE_TTL_MS) {
      delete entries[key]
      changed = true
    }
  }

  return { file: { version: 1, entries }, changed }
}
