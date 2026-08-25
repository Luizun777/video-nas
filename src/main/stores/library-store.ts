import type { Library, LibraryItem } from '@shared/types'
import { JsonStore } from './json-store'

const EMPTY: Library = { version: 1, updatedAt: new Date(0).toISOString(), items: {} }

let store: JsonStore<Library>

export async function initLibraryStore(): Promise<Library> {
  store = new JsonStore<Library>('library.json', structuredClone(EMPTY))
  const library = await store.load()
  if (!library.items || typeof library.items !== 'object') library.items = {}
  return library
}

export function getLibrary(): Library {
  return store.get()
}

export function getItem(itemId: string): LibraryItem | undefined {
  return store.get().items[itemId]
}

export function putItem(item: LibraryItem): LibraryItem {
  store.update((draft) => {
    draft.items[item.id] = item
    draft.updatedAt = new Date().toISOString()
  })
  return item
}

export function removeItems(itemIds: string[]): number {
  let removed = 0
  store.update((draft) => {
    for (const id of itemIds) {
      if (draft.items[id]) {
        delete draft.items[id]
        removed++
      }
    }
    draft.updatedAt = new Date().toISOString()
  })
  return removed
}

export function flushLibrary(): Promise<void> {
  return store.flush()
}
