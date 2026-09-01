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
 * Un episodio al azar de la serie, distinto del que se está viendo. `random` se inyecta
 * para poder testearlo; por defecto Math.random.
 */
export function pickRandomEpisode(
  item: LibraryItem,
  currentRelPath: string,
  random: () => number = Math.random
): EpisodeEntry | null {
  const episodes = sortedEpisodes(item)
  if (episodes.length === 0) return null
  const candidates = episodes.filter((e) => e.relPath !== currentRelPath)
  // Con un solo episodio se repite el mismo antes que cortar la reproducción.
  const pool = candidates.length > 0 ? candidates : episodes
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

export interface NextUpOptions {
  /** Modo aleatorio de la serie: el "siguiente" es un episodio al azar. */
  shuffle?: boolean
  random?: () => number
}

/**
 * Prioridad al terminar: episodio siguiente de la serie > primer título de la cola > nada
 * (con 'none', la UI muestra la recomendación de secuela si la hay). En modo aleatorio,
 * el episodio siguiente se sortea en vez de ir en orden.
 *
 * `queuedItems` llega EN ORDEN y ya resuelto contra la biblioteca (sin ids muertos ni
 * items missing) — ese filtrado es responsabilidad del llamador. Cualquier entrada igual
 * al item actual se salta: un título no debe recomendarse a sí mismo.
 */
export function decideNextUp(
  current: LibraryItem,
  currentRelPath: string,
  queuedItems: LibraryItem[],
  options: NextUpOptions = {}
): NextUpDecision {
  if (current.kind === 'tv') {
    const episode = options.shuffle
      ? pickRandomEpisode(current, currentRelPath, options.random)
      : findNextEpisode(current, currentRelPath)
    if (episode) return { kind: 'episode', episode }
  }

  const next = queuedItems.find((queued) => queued.id !== current.id)
  return next ? { kind: 'queue', item: next } : { kind: 'none' }
}
