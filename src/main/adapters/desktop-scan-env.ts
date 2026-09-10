import type { ScanEnv } from '@core/io'
import { ensureMounted } from '../nas/mount-manager'
import { desktopImageCache } from '../tmdb/image-cache'
import { createNodeFs } from './node-fs-adapter'

/**
 * ScanEnv de escritorio: el sistema conecta el SMB (montaje con Llavero en macOS, ruta UNC
 * con el Administrador de credenciales en Windows) + caché de imágenes en userData.
 */
export const desktopScanEnv: ScanEnv = {
  async connect(server, opts) {
    const status = await ensureMounted(server, { allowMountPrompt: opts?.allowPrompt })
    const fs =
      status.state === 'online' && status.mountPoint ? createNodeFs(status.mountPoint) : null
    return { status, fs }
  },
  images: desktopImageCache
}
