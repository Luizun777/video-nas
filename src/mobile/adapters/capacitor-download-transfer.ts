import type { PluginListenerHandle } from '@capacitor/core'
import type { DownloadTransfer } from '@core/io'
import { Nas, type DownloadProgressEvent } from '../nas-plugin'

// El estado de las descargas (cola, entradas, .part) vive en core; aquí solo se mueven
// bytes: Kotlin copia SMB → archivo local y reporta progreso por eventos del plugin.

export const capacitorDownloadTransfer: DownloadTransfer = {
  async statSource(server, relPath) {
    try {
      const stat = await Nas.statFile({ serverId: server.id, path: relPath })
      if (!stat.exists) return { error: `El archivo ya no existe en el NAS:\n${relPath}` }
      return { size: stat.size }
    } catch (error) {
      return { error: `${server.name}: ${(error as Error).message}` }
    }
  },

  async freeBytes() {
    try {
      return (await Nas.freeSpace()).bytes
    } catch {
      return null
    }
  },

  async ensureDir(dirPath) {
    await Nas.ensureDir({ path: dirPath })
  },

  async copy({ key, server, relPath, partPath, onProgress }) {
    await new Promise<void>((resolve, reject) => {
      let handle: PluginListenerHandle | null = null
      const cleanup = (): void => {
        void handle?.remove()
        handle = null
      }

      void Nas.addListener('downloadProgress', (event: DownloadProgressEvent) => {
        if (event.key !== key) return
        if (event.state === 'downloading') {
          onProgress(event.bytesDone)
        } else if (event.state === 'done') {
          cleanup()
          resolve()
        } else {
          cleanup()
          // En cancelaciones, Kotlin manda error=DOWNLOAD_CANCELLED y core lo distingue.
          reject(new Error(event.error ?? 'Error de descarga'))
        }
      }).then((h) => {
        handle = h
      })

      Nas.download({ key, serverId: server.id, path: relPath, localPath: partPath }).catch(
        (error) => {
          cleanup()
          reject(error as Error)
        }
      )
    })
  },

  cancel(key) {
    void Nas.cancelDownload({ key })
  },

  async finalize(partPath, localPath) {
    await Nas.renameFile({ from: partPath, to: localPath })
  },

  async deleteFile(path) {
    await Nas.deleteLocalFile({ path })
  },

  async exists(path) {
    try {
      return (await Nas.exists({ path })).exists
    } catch {
      return false
    }
  }
}
