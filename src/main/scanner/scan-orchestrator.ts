import { join } from 'node:path'
import type {
  LibraryItem,
  ScanProgress,
  ServerConfig,
  ServerStatus
} from '@shared/types'
import { getConfig } from '../stores/config-store'
import { flushLibrary, getLibrary, putItem, removeItems } from '../stores/library-store'
import { getOverride, setOverride, clearOverride } from '../stores/overrides-store'
import { ensureMounted } from '../nas/mount-manager'
import { identifyByTmdbId, identifyItem, type IdentifyContext } from '../tmdb/identifier'
import { ensureCacheDirs } from '../tmdb/image-cache'
import {
  groupFolder,
  mergeDuplicateMovies,
  planTmdbMerges,
  type GroupedItem,
  type ScannedFile
} from '@core/scanner/grouper'
import { walkVideos } from './walker'

export type ProgressListener = (progress: ScanProgress) => void
export type StatusListener = (statuses: ServerStatus[]) => void

const IDLE: ScanProgress = {
  phase: 'idle',
  current: 0,
  total: 0,
  label: '',
  running: false
}

let progress: ScanProgress = { ...IDLE }
let cancelled = false
let running = false
let serverStatuses: ServerStatus[] = []

/** Items identificados en paralelo. El cliente TMDB limita a 3 peticiones simultáneas. */
const IDENTIFY_CONCURRENCY = 4

const progressListeners = new Set<ProgressListener>()
const statusListeners = new Set<StatusListener>()

export function onProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

export function onStatuses(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function getProgress(): ScanProgress {
  return progress
}

export function getStatuses(): ServerStatus[] {
  return serverStatuses
}

export function isScanning(): boolean {
  return running
}

export function cancelScan(): void {
  if (running) cancelled = true
}

function emitProgress(patch: Partial<ScanProgress>): void {
  progress = { ...progress, ...patch }
  for (const listener of progressListeners) listener(progress)
}

function setStatuses(next: ServerStatus[]): void {
  serverStatuses = next
  for (const listener of statusListeners) listener(next)
}

export function updateStatus(status: ServerStatus): void {
  const next = serverStatuses.filter((s) => s.serverId !== status.serverId)
  next.push(status)
  setStatuses(next)
}

/** Comprueba el estado de todos los servidores sin escanear. */
export async function refreshStatuses(allowMountPrompt = false): Promise<ServerStatus[]> {
  const { servers } = getConfig()
  const statuses = await Promise.all(
    servers.map((server) => ensureMounted(server, { allowMountPrompt }))
  )
  setStatuses(statuses)
  return statuses
}

function itemIdFor(serverId: string, relPath: string): string {
  return `${serverId}:${relPath}`
}

function mergeGrouped(
  existing: LibraryItem | undefined,
  grouped: GroupedItem,
  serverId: string,
  now: string
): LibraryItem {
  const base: LibraryItem = existing
    ? { ...existing }
    : {
        id: itemIdFor(serverId, grouped.relPath),
        serverId,
        relPath: grouped.relPath,
        kind: grouped.kind,
        parsed: grouped.parsed,
        identify: 'unidentified',
        tmdb: null,
        firstSeenAt: now,
        lastSeenAt: now
      }

  // Lo que viene del disco siempre se refresca: las series crecen entre escaneos.
  base.kind = grouped.kind
  base.parsed = grouped.parsed
  base.videoRelPath = grouped.videoRelPath
  base.parts = grouped.parts
  // Invariante de LibraryItem: versions solo viaja si hay ≥2 copias reales.
  base.versions = grouped.versions && grouped.versions.length > 1 ? grouped.versions : undefined
  // Se conserva aunque versions se pode: es lo que permite comparar tamaños al fusionar
  // por tmdb.id después de identificar (planTmdbMerges no tiene acceso a GroupedItem).
  base.primarySize = grouped.versions?.[0]?.size
  base.episodes = grouped.episodes
  base.lastSeenAt = now
  base.missing = false
  return base
}

/** Espera antes de volver a preguntar por un título que TMDB no reconoció. */
const RETRY_UNIDENTIFIED_AFTER_MS = 7 * 24 * 60 * 60 * 1000

async function identifyIfNeeded(
  item: LibraryItem,
  ctx: IdentifyContext,
  force: boolean
): Promise<LibraryItem> {
  const override = getOverride(item.id)

  if (override?.mode === 'file-only') {
    return { ...item, identify: 'file-only', tmdb: null }
  }

  if (override?.mode === 'tmdb' && override.tmdbId) {
    // Ya aplicado y cacheado: no se vuelve a consultar TMDB.
    if (item.tmdb?.id === override.tmdbId && item.identify === 'manual') return item
    const outcome = await identifyByTmdbId(override.mediaType ?? item.kind, override.tmdbId, ctx)
    return { ...item, ...outcome }
  }

  // Ya identificado en un escaneo anterior: no se re-consulta.
  if (item.tmdb && item.identify !== 'unidentified') return item
  if (!ctx.token) return item

  // Sin match previo: se reintenta, pero no en cada arranque. Si el título parseado
  // cambió (por ejemplo tras mejorar el parser), se reintenta de inmediato.
  const lookupKey = `${item.parsed.title}|${item.parsed.year ?? ''}`
  if (!force && item.lastLookupAt && item.lookupKey === lookupKey) {
    const elapsed = Date.now() - new Date(item.lastLookupAt).getTime()
    if (Number.isFinite(elapsed) && elapsed < RETRY_UNIDENTIFIED_AFTER_MS) return item
  }

  const outcome = await identifyItem(item, ctx)
  return { ...item, ...outcome, lastLookupAt: new Date().toISOString(), lookupKey }
}

async function scanServer(
  server: ServerConfig,
  ctx: IdentifyContext,
  now: string,
  forceReidentify: boolean
): Promise<Set<string>> {
  const seen = new Set<string>()

  emitProgress({
    phase: 'mounting',
    serverId: server.id,
    serverName: server.name,
    current: 0,
    total: 0,
    label: `Conectando con ${server.name}…`
  })

  const status = await ensureMounted(server)
  updateStatus(status)

  if (status.state !== 'online' || !status.mountPoint) {
    emitProgress({
      phase: 'walking',
      label: `${server.name}: sin conexión, se conserva lo ya catalogado.`
    })
    return seen
  }

  // 1. Recorrer el disco
  const allFiles: { folder: (typeof server.folders)[number]; files: ScannedFile[] }[] = []
  for (const folder of server.folders) {
    if (cancelled) return seen
    emitProgress({
      phase: 'walking',
      serverId: server.id,
      serverName: server.name,
      current: 0,
      total: 0,
      label: `Explorando ${server.name}/${folder.path}…`
    })
    const files = await walkVideos(join(status.mountPoint, folder.path), folder.path, {
      isCancelled: () => cancelled,
      onProgress: (count) =>
        emitProgress({ label: `Explorando ${folder.path}: ${count} archivos encontrados…` })
    })
    allFiles.push({ folder, files })
  }

  // 2. Agrupar en items lógicos, y fusionar duplicados entre anclas distintas (carpeta +
  // archivo suelto del mismo título, o dos archivos sueltos) que puedan venir de
  // cualquiera de las carpetas movie configuradas en este servidor.
  const rawGrouped: GroupedItem[] = []
  for (const entry of allFiles) {
    rawGrouped.push(...groupFolder(entry.folder, entry.files))
  }
  const grouped = mergeDuplicateMovies(rawGrouped)

  // Las anclas que la fusión absorbió ya no existen como items propios: se les migra su
  // corrección manual (si tenían una y el resultado no tiene la suya propia) y se limpian
  // de la biblioteca para que no queden como "missing" eternos.
  const absorbedIds: string[] = []
  for (const item of grouped) {
    if (!item.absorbedRelPaths || item.absorbedRelPaths.length === 0) continue
    const resultId = itemIdFor(server.id, item.relPath)
    const absorbedIdsForItem = item.absorbedRelPaths.map((relPath) => itemIdFor(server.id, relPath))
    absorbedIds.push(...absorbedIdsForItem)

    if (!getOverride(resultId)) {
      const overridesFound = absorbedIdsForItem
        .map((id) => ({ id, override: getOverride(id) }))
        .filter((entry): entry is { id: string; override: NonNullable<ReturnType<typeof getOverride>> } =>
          Boolean(entry.override)
        )
      if (overridesFound.length === 1) {
        setOverride(resultId, overridesFound[0].override)
      }
    }
    for (const id of absorbedIdsForItem) clearOverride(id)
  }
  if (absorbedIds.length > 0) removeItems(absorbedIds)

  // 3. Diferencia contra la biblioteca e identificación de los nuevos.
  // Se procesan en lotes: el limitador del cliente TMDB sigue marcando el ritmo real.
  const library = getLibrary()
  let processed = 0

  for (let offset = 0; offset < grouped.length; offset += IDENTIFY_CONCURRENCY) {
    if (cancelled) return seen
    const chunk = grouped.slice(offset, offset + IDENTIFY_CONCURRENCY)

    await Promise.all(
      chunk.map(async (groupedItem) => {
        const id = itemIdFor(server.id, groupedItem.relPath)
        seen.add(id)

        const existing = library.items[id]
        const merged = mergeGrouped(existing, groupedItem, server.id, now)
        const needsLookup = !merged.tmdb && merged.identify === 'unidentified'

        emitProgress({
          phase: 'identifying',
          serverId: server.id,
          serverName: server.name,
          current: processed,
          total: grouped.length,
          label: needsLookup
            ? `Identificando: ${merged.parsed.title}`
            : `Actualizando: ${merged.parsed.title}`
        })

        const identified = await identifyIfNeeded(merged, ctx, forceReidentify)
        putItem(identified)
        processed++
      })
    )

    emitProgress({ current: processed, total: grouped.length })
  }

  return seen
}

/**
 * Segunda pasada de fusión, tras identificar: agrupa por tmdb.id en vez de por título de
 * archivo. Atrapa duplicados que mergeDuplicateMovies no pudo unir porque los nombres no
 * se parecían (idioma distinto, año ausente en una copia) pero que ahora sabemos, con
 * certeza, que son la misma película.
 */
function applyTmdbMerges(): void {
  const library = getLibrary()
  const plans = planTmdbMerges(Object.values(library.items))

  for (const plan of plans) {
    const anchor = library.items[plan.anchorId]
    if (!anchor) continue

    const versions = plan.versions.length > 1 ? plan.versions : undefined
    putItem({
      ...anchor,
      videoRelPath: plan.versions[0]?.videoRelPath ?? anchor.videoRelPath,
      parts: plan.versions[0]?.parts,
      versions,
      primarySize: plan.versions[0]?.size ?? anchor.primarySize
    })

    if (!getOverride(plan.anchorId)) {
      const overridesFound = plan.absorbedIds
        .map((id) => getOverride(id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
      if (overridesFound.length === 1) setOverride(plan.anchorId, overridesFound[0])
    }
    for (const id of plan.absorbedIds) clearOverride(id)
    removeItems(plan.absorbedIds)
  }
}

export interface ScanOptions {
  /** Vuelve a consultar TMDB también para los items ya identificados. */
  full?: boolean
}

export async function startScan(options: ScanOptions = {}): Promise<void> {
  if (running) return
  running = true
  cancelled = false

  const config = getConfig()
  const ctx: IdentifyContext = { token: config.tmdbBearerToken, language: config.language }
  const now = new Date().toISOString()

  emitProgress({ ...IDLE, phase: 'mounting', running: true, label: 'Iniciando escaneo…' })

  try {
    await ensureCacheDirs()

    if (options.full) {
      // Re-identificar todo: se limpia el match para forzar la búsqueda.
      const library = getLibrary()
      for (const item of Object.values(library.items)) {
        if (item.identify === 'auto') {
          putItem({ ...item, tmdb: null, identify: 'unidentified' })
        }
      }
    }

    const seenIds = new Set<string>()
    const onlineServerIds = new Set<string>()

    for (const server of config.servers) {
      if (cancelled) break
      if (!server.enabled) {
        updateStatus({ serverId: server.id, state: 'disabled' })
        continue
      }
      const seen = await scanServer(server, ctx, now, options.full ?? false)
      for (const id of seen) seenIds.add(id)
      if (seen.size > 0) onlineServerIds.add(server.id)
    }

    if (!cancelled) applyTmdbMerges()

    // Marcar como ausentes los items de servidores en línea que ya no están en disco.
    if (!cancelled) {
      const library = getLibrary()
      for (const item of Object.values(library.items)) {
        if (!onlineServerIds.has(item.serverId)) continue
        if (seenIds.has(item.id)) continue
        if (item.missing) continue
        putItem({ ...item, missing: true })
      }
    }

    await flushLibrary()
    emitProgress({
      phase: cancelled ? 'idle' : 'done',
      running: false,
      label: cancelled ? 'Escaneo cancelado.' : 'Biblioteca actualizada.'
    })
  } catch (error) {
    emitProgress({
      phase: 'error',
      running: false,
      label: `Error durante el escaneo: ${(error as Error).message}`
    })
  } finally {
    running = false
    cancelled = false
  }
}
