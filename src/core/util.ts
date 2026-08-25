// Módulo PURO: sustitutos de APIs de Node/navegador moderno que no existen en todos los
// entornos donde corre src/core (proceso main de Electron Y WebView de Android).

/** Id corto con prefijo, ej. "srv_a1b2c3d4". Sustituye a node:crypto.randomUUID. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}_${hex}`
}

/**
 * Sustituto de AbortSignal.timeout() (Chrome 103+): WebViews viejos no lo tienen.
 * El timer no se limpia al abortar por otra vía; para señales de request es inocuo.
 */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error(`Timeout de ${ms} ms`)), ms)
  return controller.signal
}

/** Clon profundo de datos JSON-serializables. Sustituye a structuredClone (Chrome 98+). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
