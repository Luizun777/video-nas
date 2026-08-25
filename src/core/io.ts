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
}

export interface ImageCacheAdapter {
  ensureReady(): Promise<void>
  /** Descarga si no está y devuelve la ruta relativa en caché ("posters/m-603-w342.jpg"). */
  cachePoster(kind: MediaKind, tmdbId: number, tmdbPath: string | null): Promise<string | undefined>
  cacheBackdrop(kind: MediaKind, tmdbId: number, tmdbPath: string | null): Promise<string | undefined>
}

/** Lo que el escáner necesita de la plataforma. */
export interface ScanEnv {
  /**
   * Conecta con el share del servidor. Desktop: montaje vía Llavero de macOS
   * (allowPrompt controla si puede abrir el diálogo). Android: sesión SMB con las
   * credenciales guardadas. `fs` es null cuando el servidor no quedó online.
   */
  connect(
    server: ServerConfig,
    opts?: { allowPrompt?: boolean }
  ): Promise<{ status: ServerStatus; fs: FsAdapter | null }>
  images: ImageCacheAdapter
}
