import { getItem } from '../stores/library-store'
import { getServerById } from '../stores/config-store'
import { getLocalCopy } from '../downloads/download-manager'
import { resolveNasPath } from '../nas/mount-manager'

/**
 * Resuelve la ruta absoluta actual de un archivo. El renderer nunca la construye: pide
 * play(itemId) o una URL videofile://, y aquí se decide primero si hay una copia local
 * descargada (reproduce sin NAS) y si no, se resuelve contra el punto de montaje actual.
 *
 * Vive en su propio módulo (y no en ipc.ts) porque la comparten el handler de IPC y el
 * del protocolo de streaming, que no deben importarse entre sí.
 */
export async function resolveAbsolutePath(
  itemId: string,
  relPath?: string
): Promise<{ absPath: string } | { error: string }> {
  const item = getItem(itemId)
  if (!item) return { error: 'No se encontró el título en la biblioteca.' }

  const target = relPath ?? item.videoRelPath ?? item.episodes?.[0]?.relPath ?? item.relPath

  const localCopy = getLocalCopy(itemId, target)
  if (localCopy) return { absPath: localCopy }

  const server = getServerById(item.serverId)
  if (!server) return { error: 'El servidor de este título ya no está configurado.' }

  return resolveNasPath(server, target)
}
