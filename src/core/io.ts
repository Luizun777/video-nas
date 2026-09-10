import type { MediaKind, ServerConfig, ServerStatus } from '@shared/types'

// Interfaces de IO que src/core necesita del mundo exterior. Cada plataforma las
// implementa UNA vez: Electron con Node (src/main/adapters/) y Android con Capacitor
// + el plugin nativo (src/mobile/adapters/). src/core no importa electron, node:* ni
// @capacitor/*; todo acceso a disco o red de plataforma pasa por aquí.

export interface StoreIO {
  /** Contenido del archivo de datos, o null si no existe. */
  read(fileName: string): Promise<string | null>
  /** Escritura atómica (tmp + rename): nunca deja un JSON a medias en disco. */
  writeAtomic(fileName: string, contents: string): Promise<void>
}

export interface FsEntry {
  name: string
  dir: boolean
  /** Bytes del archivo. 0 en directorios. */
  size: number
}

/**
 * Listado de archivos anclado a la raíz del share (rutas relativas POSIX, sin "/"
 * inicial). Desktop: readdir+stat sobre el punto de montaje. Android: listDir del
 * plugin SMB, que ya trae los tamaños en el propio listado.
 */
export interface FsAdapter {
  readDir(relPath: string): Promise<FsEntry[]>
  /** Contenido completo de un archivo PEQUEÑO (metadata compartida), o null si no existe. */
  readFile(relPath: string): Promise<Uint8Array | null>
  /** Escritura atómica en el share (tmp + rename), creando las carpetas padre. */
  writeFile(relPath: string, data: Uint8Array): Promise<void>
}

export interface ImageCacheAdapter {
  ensureReady(): Promise<void>
  /** Descarga si no está y devuelve la ruta relativa en caché ("posters/m-603-w342.jpg"). */
  cachePoster(kind: MediaKind, tmdbId: number, tmdbPath: string | null): Promise<string | undefined>
  cacheBackdrop(kind: MediaKind, tmdbId: number, tmdbPath: string | null): Promise<string | undefined>
}

/**
 * Movimiento de bytes de las descargas offline. El estado (cola, entradas, progreso)
 * vive en core; los streams/statfs (Node) o el copiado nativo (Kotlin) viven aquí.
 */
export interface DownloadTransfer {
  /** Tamaño del archivo de origen en el NAS, o error legible si no está accesible. */
  statSource(server: ServerConfig, relPath: string): Promise<{ size: number } | { error: string }>
  /** Bytes libres en el volumen de descargas, o null si no se pudo comprobar. */
  freeBytes(downloadsPath: string): Promise<number | null>
  ensureDir(dirPath: string): Promise<void>
  /**
   * Copia el origen a partPath reportando progreso (ya throttled). Si cancel(key)
   * aborta la copia, debe rechazar con un Error cuyo message sea DOWNLOAD_CANCELLED.
   */
  copy(req: {
    key: string
    server: ServerConfig
    relPath: string
    partPath: string
    totalBytes: number
    onProgress: (bytesDone: number) => void
  }): Promise<void>
  /** Aborta la copia en curso de key, si la hay. */
  cancel(key: string): void
  /** Renombra la copia terminada: .part → destino definitivo. */
  finalize(partPath: string, localPath: string): Promise<void>
  deleteFile(path: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** Lo que el escáner necesita de la plataforma. */
export interface ScanEnv {
  /**
   * Conecta con el share del servidor. Desktop: montaje vía Llavero en macOS o ruta UNC
   * en Windows (allowPrompt controla si puede abrir el diálogo). Android: sesión SMB con las
   * credenciales guardadas. `fs` es null cuando el servidor no quedó online.
   */
  connect(
    server: ServerConfig,
    opts?: { allowPrompt?: boolean }
  ): Promise<{ status: ServerStatus; fs: FsAdapter | null }>
  images: ImageCacheAdapter
}
