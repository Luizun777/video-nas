import type { PlaybackProgressEntry, ProgressFile } from '@shared/types'
import type { StoreIO } from '../io'
import { JsonStore } from './json-store'

// "Continuar viendo". Hoy solo lo inicializa Android; el desktop ni lo carga, así que
// el renderer hace feature-detect de los métodos opcionales de IpcApi.

/** Visto ≥95% cuenta como terminado y sale de "Continuar viendo". */
const FINISHED_RATIO = 0.95
/** Los primeros segundos no valen la pena reanudarlos ni ensucian la fila. */
const MIN_RESUME_SEC = 30

let store: JsonStore<ProgressFile>

export async function initProgressStore(io: StoreIO): Promise<ProgressFile> {
  store = new JsonStore<ProgressFile>(io, 'progress.json', { version: 1, entries: {} })
  const data = await store.load()
  if (!data.entries || typeof data.entries !== 'object') data.entries = {}
  return data
}

export function getAllProgress(): PlaybackProgressEntry[] {
  return Object.values(store.get().entries)
}

export function getProgressFor(key: string): PlaybackProgressEntry | undefined {
  return store.get().entries[key]
}

export function setProgress(entry: Omit<PlaybackProgressEntry, 'updatedAt' | 'finished'>): void {
  store.update((draft) => {
    const finished =
      entry.durationSec > 0 && entry.positionSec / entry.durationSec >= FINISHED_RATIO
    if (finished) {
      draft.entries[entry.key] = {
        ...entry,
        positionSec: entry.durationSec,
        finished: true,
        updatedAt: new Date().toISOString()
      }
    } else if (entry.positionSec < MIN_RESUME_SEC) {
      delete draft.entries[entry.key]
    } else {
      draft.entries[entry.key] = { ...entry, finished: false, updatedAt: new Date().toISOString() }
    }
  })
}

export function clearProgress(key: string): void {
  store.update((draft) => {
    delete draft.entries[key]
  })
}

export function flushProgress(): Promise<void> {
  return store.flush()
}
