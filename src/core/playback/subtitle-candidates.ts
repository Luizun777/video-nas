// Descubrimiento de subtítulos externos junto al video, al momento de reproducir.
// Puro a propósito (sin IO): cada plataforma lista los directorios como pueda y esto
// decide qué archivos son subtítulos de ESTE video. El escáner ignora los .srt y las
// carpetas Subs/ (walker.ts) — por eso se buscan aquí y no en el catálogo.

export interface SubtitleCandidate {
  /** Nombre de archivo, tal cual. */
  name: string
  /** Ruta relativa AL DIRECTORIO del video ("La peli.es.srt" o "Subs/2_Spanish.srt"). */
  relPath: string
  /** Código de idioma inferido del sufijo del nombre (es, en, lat…), si lo hay. */
  language?: string
}

export interface SubtitleSearchInput {
  /** Nombre del archivo de video ("La.Peli.2020.1080p.mkv"). */
  videoFileName: string
  /** Nombres de archivo (no dirs) del directorio del video. */
  dirEntries: string[]
  /** Contenido de subcarpetas de subtítulos (Subs/, Subtitles/…), si existen. */
  subsDirEntries?: { dir: string; names: string[] }[]
}

const SUB_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt']

/** Sufijos de idioma habituales en releases: "peli.es.srt", "peli.spa.srt", "peli.lat.srt". */
const KNOWN_LANGS = new Set([
  'es', 'spa', 'esp', 'lat', 'mx',
  'en', 'eng', 'ing',
  'pt', 'por', 'fr', 'fre', 'de', 'ger', 'it', 'ita', 'ja', 'jpn', 'forced'
])

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

function isSubtitleFile(name: string): boolean {
  return SUB_EXTENSIONS.includes(extensionOf(name))
}

/** "La peli.es" → "es"; "La peli" → undefined. Solo sufijos de idioma conocidos. */
function languageOf(subBaseName: string): string | undefined {
  const dot = subBaseName.lastIndexOf('.')
  if (dot <= 0) return undefined
  const suffix = subBaseName.slice(dot + 1).toLowerCase()
  return KNOWN_LANGS.has(suffix) ? suffix : undefined
}

/**
 * Subtítulos de ESTE video, en orden de confianza:
 *  1. Mismo basename del video (con o sin sufijo de idioma), en el propio directorio.
 *  2. Todo lo que haya en las subcarpetas de subtítulos (pertenecen a la carpeta del título).
 *  3. Un único .srt "suelto" en el directorio: en carpetas de una sola película es suyo.
 * Con varios sueltos que no coinciden con el basename NO se adivina (podrían ser de
 * otros archivos en carpetas multi-episodio).
 */
export function findSubtitleCandidates(input: SubtitleSearchInput): SubtitleCandidate[] {
  const videoBase = baseName(input.videoFileName).toLowerCase()
  const results: SubtitleCandidate[] = []

  const subsInDir = input.dirEntries.filter(isSubtitleFile)
  const matching = subsInDir.filter((name) => baseName(name).toLowerCase().startsWith(videoBase))
  for (const name of matching) {
    results.push({ name, relPath: name, language: languageOf(baseName(name)) })
  }

  for (const subsDir of input.subsDirEntries ?? []) {
    for (const name of subsDir.names.filter(isSubtitleFile)) {
      results.push({
        name,
        relPath: `${subsDir.dir}/${name}`,
        language: languageOf(baseName(name))
      })
    }
  }

  if (results.length === 0 && subsInDir.length === 1) {
    const only = subsInDir[0]
    results.push({ name: only, relPath: only, language: languageOf(baseName(only)) })
  }

  return results
}
