import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { StoreIO } from '@core/io'

// Los JSON de la app viven en el directorio de datos privado (equivalente al userData
// del desktop): config.json, library.json, overrides.json, queue.json, downloads.json,
// progress.json.

export const capacitorStoreIO: StoreIO = {
  async read(fileName) {
    try {
      const result = await Filesystem.readFile({
        path: fileName,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      })
      return typeof result.data === 'string' ? result.data : null
    } catch {
      return null
    }
  },

  async writeAtomic(fileName, contents) {
    const tmp = `${fileName}.tmp`
    await Filesystem.writeFile({
      path: tmp,
      directory: Directory.Data,
      data: contents,
      encoding: Encoding.UTF8,
      recursive: true
    })
    try {
      await Filesystem.rename({
        from: tmp,
        to: fileName,
        directory: Directory.Data,
        toDirectory: Directory.Data
      })
    } catch {
      // Algunos Android no renombran sobre un archivo existente: borrar y reintentar.
      await Filesystem.deleteFile({ path: fileName, directory: Directory.Data }).catch(() => {})
      await Filesystem.rename({
        from: tmp,
        to: fileName,
        directory: Directory.Data,
        toDirectory: Directory.Data
      })
    }
  }
}
