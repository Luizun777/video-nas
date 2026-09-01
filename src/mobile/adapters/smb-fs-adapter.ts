import type { FsAdapter } from '@core/io'
import { Nas } from '../nas-plugin'

/**
 * FsAdapter sobre el plugin SMB nativo. Normaliza los nombres a NFC AQUÍ y no en core:
 * los ids del desktop se construyeron con el NFD que entrega el mount de macOS y no
 * deben cambiar; la biblioteca de la tablet es propia, así que NFC estable es correcto
 * (y cleanTitle ya normaliza a NFC por su cuenta para las búsquedas).
 */
export function createSmbFs(serverId: string): FsAdapter {
  return {
    async readDir(relPath) {
      const { entries } = await Nas.listDir({ serverId, path: relPath })
      return entries.map((entry) => ({ ...entry, name: entry.name.normalize('NFC') }))
    },

    async readFile(relPath) {
      const { data } = await Nas.readNasFile({ serverId, path: relPath })
      if (data === undefined || data === null) return null
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    },

    async writeFile(relPath, data) {
      let binary = ''
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
      const { ok } = await Nas.writeNasFile({ serverId, path: relPath, data: btoa(binary) })
      if (!ok) throw new Error('No se pudo escribir en el share.')
    }
  }
}
