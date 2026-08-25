import type { MetadataOverride, Overrides } from '@shared/types'
import type { StoreIO } from '../io'
import { JsonStore } from './json-store'

// Archivo aparte de library.json a propósito: el escaneo puede regenerar el catálogo
// entero sin riesgo de perder las correcciones manuales del usuario.

let store: JsonStore<Overrides>

export async function initOverridesStore(io: StoreIO): Promise<Overrides> {
  store = new JsonStore<Overrides>(io, 'overrides.json', {})
  return store.load()
}

export function getOverride(itemId: string): MetadataOverride | undefined {
  return store.get()[itemId]
}

export function getAllOverrides(): Overrides {
  return store.get()
}

export function setOverride(itemId: string, override: MetadataOverride): void {
  store.update((draft) => {
    draft[itemId] = override
  })
}

export function clearOverride(itemId: string): void {
  store.update((draft) => {
    delete draft[itemId]
  })
}

export function flushOverrides(): Promise<void> {
  return store.flush()
}
