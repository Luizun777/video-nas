import type { LibraryItem } from '@shared/types'

/**
 * Fallback del objetivo de reproducción/descarga, compartido por todas las rutas que
 * aceptan un relPath opcional: relPath explícito > archivo de la película > primer
 * episodio > ancla del item.
 */
export function pickTargetRelPath(
  item: Pick<LibraryItem, 'videoRelPath' | 'episodes' | 'relPath'>,
  relPath?: string
): string {
  return relPath ?? item.videoRelPath ?? item.episodes?.[0]?.relPath ?? item.relPath
}
