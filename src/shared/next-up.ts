// Módulo PURO: decide qué sigue cuando termina la reproducción actual.
// Sin imports de electron/fs/react: testeable directo con vitest.

import type { EpisodeEntry, LibraryItem, NextUpDecision } from './types'

export function sortedEpisodes(item: LibraryItem): EpisodeEntry[] {
  return [...(item.episodes ?? [])].sort((a, b) => a.season - b.season || a.episode - b.episode)
}

export function findNextEpisode(item: LibraryItem, currentRelPath: string): EpisodeEntry | null {
  const episodes = sortedEpisodes(item)
  const index = episodes.findIndex((e) => e.relPath === currentRelPath)
  if (index === -1 || index === episodes.length - 1) return null
  return episodes[index + 1]
}

/**
 * Prioridad al terminar: episodio siguiente de la serie > primer título de la cola > nada
 * (con 'none', la UI muestra la recomendación de secuela si la hay).
 *
 * `queuedItems` llega EN ORDEN y ya resuelto contra la biblioteca (sin ids muertos ni
 * items missing) — ese filtrado es responsabilidad del llamador. Cualquier entrada igual
 * al item actual se salta: un título no debe recomendarse a sí mismo.
 */
export function decideNextUp(
  current: LibraryItem,
  currentRelPath: string,
  queuedItems: LibraryItem[]
): NextUpDecision {
  if (current.kind === 'tv') {
    const episode = findNextEpisode(current, currentRelPath)
    if (episode) return { kind: 'episode', episode }
  }

  const next = queuedItems.find((queued) => queued.id !== current.id)
  return next ? { kind: 'queue', item: next } : { kind: 'none' }
}
