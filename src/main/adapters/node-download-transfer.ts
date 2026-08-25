import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { DownloadTransfer } from '@core/io'
import { DOWNLOAD_CANCELLED } from '@core/downloads/download-manager'
import { resolveNasPath } from '../nas/mount-manager'

const PROGRESS_THROTTLE_MS = 500

/** Aborta la copia en curso de `key`, si la hay. */
const activeAborts = new Map<string, () => void>()

export const nodeDownloadTransfer: DownloadTransfer = {
  async statSource(server, relPath) {
    const resolved = await resolveNasPath(server, relPath)
    if ('error' in resolved) return resolved
    try {
      return { size: (await fs.stat(resolved.absPath)).size }
    } catch {
      return { error: 'No se pudo leer el archivo de origen en el NAS.' }
    }
  },

  async freeBytes(downloadsPath) {
    try {
      const stats = await fs.statfs(downloadsPath)
      return stats.bavail * stats.bsize
    } catch {
      return null
    }
  },

  async ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true })
  },

  async copy({ key, server, relPath, partPath, totalBytes, onProgress }) {
    // Se re-resuelve aquí (no en el stat previo): el punto de montaje pudo cambiar
    // mientras la descarga esperaba turno en la cola.
    const resolved = await resolveNasPath(server, relPath)
    if ('error' in resolved) throw new Error(resolved.error)

    const readStream = createReadStream(resolved.absPath)
    const writeStream = createWriteStream(partPath)

    let bytesDone = 0
    let lastEmit = 0
    readStream.on('data', (chunk: Buffer) => {
      bytesDone += chunk.length
      const now = Date.now()
      if (now - lastEmit >= PROGRESS_THROTTLE_MS || bytesDone >= totalBytes) {
        lastEmit = now
        onProgress(bytesDone)
      }
    })

    activeAborts.set(key, () => readStream.destroy(new Error(DOWNLOAD_CANCELLED)))
    try {
      await pipeline(readStream, writeStream)
    } finally {
      activeAborts.delete(key)
    }
  },

  cancel(key) {
    activeAborts.get(key)?.()
  },

  async finalize(partPath, localPath) {
    await fs.rename(partPath, localPath)
  },

  async deleteFile(path) {
    await fs.unlink(path).catch(() => {})
  },

  async exists(path) {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  }
}
