import type { StoreIO } from '../io'

/**
 * Persistencia JSON con escritura atómica (tmp + rename, dentro del StoreIO) y debounce.
 * Sin dependencias externas: el catálogo cabe holgadamente en memoria. El acceso a disco
 * vive detrás de StoreIO para que el mismo store corra en el main de Electron (userData)
 * y en el WebView de Android (Filesystem de Capacitor).
 */
export class JsonStore<T> {
  private data: T
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly io: StoreIO,
    private readonly fileName: string,
    private readonly fallback: T
  ) {
    this.data = fallback
  }

  async load(): Promise<T> {
    try {
      const raw = await this.io.read(this.fileName)
      this.data = raw === null ? this.fallback : (JSON.parse(raw) as T)
    } catch {
      // Archivo corrupto: se parte del valor por defecto.
      this.data = this.fallback
    }
    return this.data
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.scheduleWrite()
  }

  update(mutator: (draft: T) => void): T {
    mutator(this.data)
    this.scheduleWrite()
    return this.data
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      // Si falla, el siguiente cambio vuelve a escribir el estado completo.
      this.flush().catch((error: unknown) => console.warn(`No se pudo guardar ${this.fileName}:`, error))
    }, 400)
  }

  /** Escribe ya, sin esperar al debounce. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = JSON.stringify(this.data, null, 2)
    // El catch mantiene viva la cadena: sin él, UNA escritura fallida (en Windows basta un
    // rename con EPERM porque el antivirus tiene el archivo abierto) rechazaba todas las
    // siguientes y el store dejaba de guardar hasta reiniciar la app.
    this.writing = this.writing
      .catch(() => {})
      .then(() => this.io.writeAtomic(this.fileName, snapshot))
    return this.writing
  }
}
