import type { ServerConfig, SharedOverridesFile } from '@shared/types'
import type { FsAdapter, ScanEnv } from '../io'
import { getConfig } from '../stores/config-store'
import { getLibrary, putItem } from '../stores/library-store'
import { flushOverrides, getAllOverrides, getOverride, setOverride } from '../stores/overrides-store'
import { resetForReidentify } from './override-service'
import {
  buildRemoteUpdate,
  keyForRelPath,
  parseSharedOverrides,
  planRemoteApplies,
  serializeSharedOverrides,
  SHARED_OVERRIDES_PATH
} from './shared-overrides'

/**
 * Lectura/escritura del archivo compartido de correcciones en cada share. Best-effort
 * SIEMPRE: un NAS apagado o un share de solo lectura no rompe nada — lo pendiente se
 * distingue con override.syncedAt y se reintenta en el siguiente escaneo.
 */

let env: ScanEnv | null = null

/** El mismo ScanEnv del escáner (mount por Llavero en macOS, SMB en Android). */
export function initSharedOverridesSync(scanEnv: ScanEnv): void {
  env = scanEnv
}

async function readRemote(fs: FsAdapter): Promise<SharedOverridesFile | null> {
  try {
    const bytes = await fs.readFile(SHARED_OVERRIDES_PATH)
    return parseSharedOverrides(bytes ? new TextDecoder().decode(bytes) : null)
  } catch {
    return null
  }
}

/**
 * Aplica localmente lo remoto más nuevo. Corre dentro del escaneo, DESPUÉS del walk
 * (las claves NFC se mapean contra los relPaths reales recién caminados: NFC→NFD no es
 * invertible con certeza en macOS) y ANTES de identificar, para que la misma pasada
 * materialice portadas nuevas y deshaga los "restaurar automático" (tombstones).
 */
export async function pullSharedOverrides(
  server: ServerConfig,
  fs: FsAdapter,
  walkedRelPaths: string[]
): Promise<void> {
  const remote = await readRemote(fs)
  if (!remote || Object.keys(remote.entries).length === 0) return

  const localByKey = new Map<string, { itemId: string; override?: ReturnType<typeof getOverride> }>()
  const add = (relPath: string, itemId: string): void => {
    const key = keyForRelPath(relPath)
    if (!localByKey.has(key)) localByKey.set(key, { itemId, override: getOverride(itemId) })
  }
  for (const relPath of walkedRelPaths) add(relPath, `${server.id}:${relPath}`)
  for (const item of Object.values(getLibrary().items)) {
    if (item.serverId === server.id) add(item.relPath, item.id)
  }

  for (const { itemId, entry } of planRemoteApplies(remote, localByKey)) {
    // syncedAt = setAt: lo que acaba de llegar del NAS no hay que re-empujarlo.
    setOverride(itemId, {
      mode: entry.mode,
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
      setAt: entry.setAt,
      syncedAt: entry.setAt
    })
    const item = getLibrary().items[itemId]
    if (!item) continue
    if (entry.mode === 'none') {
      // Restaurado en otro dispositivo: resetear para que se re-identifique ya.
      putItem(resetForReidentify(item))
    }
    // 'tmdb'/'file-only' no necesitan reset: identifyIfNeeded ve el override en esta
    // misma pasada (el match cacheado no coincide con el tmdbId nuevo).
  }
  await flushOverrides()
}

/** Sube al share los overrides locales del server que aún no viajaron (setAt > syncedAt). */
export async function pushSharedOverrides(server: ServerConfig, fs: FsAdapter): Promise<void> {
  const prefix = `${server.id}:`
  const pending: { itemId: string; key: string; setAt: string }[] = []
  const pushes = []
  for (const [itemId, override] of Object.entries(getAllOverrides())) {
    if (!itemId.startsWith(prefix)) continue
    if (override.syncedAt && override.syncedAt >= override.setAt) continue
    const key = keyForRelPath(itemId.slice(prefix.length))
    pending.push({ itemId, key, setAt: override.setAt })
    pushes.push({
      key,
      entry: {
        mode: override.mode,
        tmdbId: override.tmdbId,
        mediaType: override.mediaType,
        setAt: override.setAt
      }
    })
  }
  if (pending.length === 0) return

  try {
    const remote = (await readRemote(fs)) ?? { version: 1 as const, entries: {} }
    const { file, changed } = buildRemoteUpdate(remote, pushes, Date.now())
    if (changed) {
      await fs.writeFile(SHARED_OVERRIDES_PATH, new TextEncoder().encode(serializeSharedOverrides(file)))
    }
    // Aunque el remoto ya tuviera algo más nuevo (changed=false), lo local quedó "visto".
    for (const entry of pending) {
      const current = getOverride(entry.itemId)
      if (current && current.setAt === entry.setAt) {
        setOverride(entry.itemId, { ...current, syncedAt: current.setAt })
      }
    }
    await flushOverrides()
  } catch {
    // Share offline o de solo lectura: sigue pendiente para el próximo escaneo.
  }
}

/** Al aplicar/restaurar desde la UI: empujar ya, sin esperar al siguiente escaneo. */
export function trySyncServer(serverId: string): void {
  if (!env) return
  const server = getConfig().servers.find((s) => s.id === serverId)
  if (!server || !server.enabled) return
  void env
    .connect(server, { allowPrompt: false })
    .then(({ fs }) => (fs ? pushSharedOverrides(server, fs) : undefined))
    .catch(() => {})
}
