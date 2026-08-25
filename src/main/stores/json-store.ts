import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * Persistencia JSON con escritura atómica (tmp + rename) y debounce.
 * Sin dependencias externas: el catálogo cabe holgadamente en memoria.
 */
export class JsonStore<T> {
  private data: T
  private readonly filePath: string
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(fileName: string, private readonly fallback: T) {
    this.filePath = join(app.getPath('userData'), fileName)
    this.data = fallback
  }

  get path(): string {
    return this.filePath
  }

  async load(): Promise<T> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      this.data = JSON.parse(raw) as T
    } catch {
      // Primer arranque o archivo corrupto: se parte del valor por defecto.
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
      void this.flush()
    }, 400)
  }

  /** Escribe ya, sin esperar al debounce. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writing = this.writing.then(async () => {
      const tmp = `${this.filePath}.tmp`
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      await fs.writeFile(tmp, snapshot, 'utf-8')
      await fs.rename(tmp, this.filePath)
    })
    return this.writing
  }
}
