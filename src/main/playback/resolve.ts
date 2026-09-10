import { existsSync } from 'node:fs'
import { normalize } from 'node:path'
import { getItem } from '@core/stores/library-store'
import { getServerById } from '@core/stores/config-store'
import { getLocalCopy } from '@core/downloads/download-manager'
import { pickTargetRelPath } from '@core/playback/resolve-target'
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

  const target = pickTargetRelPath(item, relPath)

  // getLocalCopy ya no toca disco (core no tiene fs): la comprobación vive aquí, para
  // que una copia borrada por fuera a mitad de sesión caiga de vuelta al NAS.
  const localCopy = getLocalCopy(itemId, target)
  // normalize: en Windows la copia llega con separadores mezclados (C:\…\Video NAS/Movies/x.mkv),
  // que el shell del sistema no siempre acepta y que rompen la comparación de rutas de subtítulos.
  if (localCopy && existsSync(localCopy)) return { absPath: normalize(localCopy) }

  const server = getServerById(item.serverId)
  if (!server) return { error: 'El servidor de este título ya no está configurado.' }

  return resolveNasPath(server, target)
}
