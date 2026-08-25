// Módulo PURO: lee capítulos de un contenedor Matroska (MKV/WebM) directamente de sus
// bytes, sin dependencias ni ffmpeg. Sin imports de fs ni electron: testeable con vitest
// construyendo bytes EBML sintéticos.
//
// Best-effort por diseño: ante cualquier byte inesperado devuelve lista vacía y nunca
// lanza. Un archivo raro no debe impedir reproducir.

export interface RawChapter {
  startSeconds: number
  endSeconds: number | null
  titles: string[]
}

const IDS = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Cluster: 0x1f43b675,
  Chapters: 0x1043a770,
  EditionEntry: 0x45b9,
  ChapterAtom: 0xb6,
  ChapterTimeStart: 0x91,
  ChapterTimeEnd: 0x92,
  ChapterDisplay: 0x80,
  ChapString: 0x85
} as const

/**
 * ChapterTimeStart/End son nanosegundos ABSOLUTOS: TimecodeScale escala los timestamps de
 * los Cluster (el video), no los capítulos. Verificado contra un MKV real.
 */
const NANOSECONDS_PER_SECOND = 1_000_000_000

interface Vint {
  length: number
  value: bigint
}

/**
 * Lee un entero de longitud variable de EBML.
 *
 * `keepMarker` distingue los dos usos: el ID de un elemento incluye el bit marcador de
 * longitud (por eso Segment es 0x18538067 y no 0x08538067), mientras que el tamaño se
 * decodifica quitándolo.
 */
function readVint(buf: Uint8Array, offset: number, keepMarker: boolean): Vint | null {
  if (offset >= buf.length) return null
  const first = buf[offset]
  if (first === 0) return null

  let length = 1
  let mask = 0x80
  while (mask !== 0 && (first & mask) === 0) {
    mask >>= 1
    length++
  }
  if (length > 8 || offset + length > buf.length) return null

  let value = keepMarker ? BigInt(first) : BigInt(first & (mask - 1))
  for (let i = 1; i < length; i++) value = (value << 8n) | BigInt(buf[offset + i])
  return { length, value }
}

/** Un tamaño con todos los bits de datos en 1 significa "desconocido" (streaming). */
function isUnknownSize(vint: Vint): boolean {
  return vint.value === (1n << BigInt(7 * vint.length)) - 1n
}

function readUint(buf: Uint8Array, start: number, end: number): bigint {
  let value = 0n
  for (let i = start; i < end; i++) value = (value << 8n) | BigInt(buf[i])
  return value
}

function decodeUtf8(buf: Uint8Array, start: number, end: number): string {
  return new TextDecoder('utf-8').decode(buf.subarray(start, end))
}

type ChildVisitor = (id: number, payloadStart: number, payloadEnd: number) => 'stop' | void

/** Recorre los elementos hijos contenidos en [start, end). */
function walkChildren(buf: Uint8Array, start: number, end: number, onElement: ChildVisitor): void {
  let cursor = start
  while (cursor < end) {
    const id = readVint(buf, cursor, true)
    if (!id) return

    const sizeOffset = cursor + id.length
    const size = readVint(buf, sizeOffset, false)
    if (!size) return

    const payloadStart = sizeOffset + size.length
    if (isUnknownSize(size)) return
    const payloadEnd = payloadStart + Number(size.value)
    if (payloadEnd > buf.length || payloadEnd > end) return

    if (onElement(Number(id.value), payloadStart, payloadEnd) === 'stop') return
    cursor = payloadEnd
  }
}

export function parseChaptersFromBuffer(buf: Uint8Array): RawChapter[] {
  try {
    // 1. Localizar el Segment. Puede declararse con tamaño desconocido, en cuyo caso se
    // asume que llega hasta donde alcanza el buffer leído.
    let segmentStart = -1
    let segmentEnd = buf.length
    let cursor = 0

    while (cursor < buf.length) {
      const id = readVint(buf, cursor, true)
      if (!id) break
      const sizeOffset = cursor + id.length
      const size = readVint(buf, sizeOffset, false)
      if (!size) break
      const payloadStart = sizeOffset + size.length
      const payloadEnd = isUnknownSize(size) ? buf.length : payloadStart + Number(size.value)

      if (Number(id.value) === IDS.Segment) {
        segmentStart = payloadStart
        segmentEnd = Math.min(payloadEnd, buf.length)
        break
      }
      if (payloadEnd <= cursor) break
      cursor = payloadEnd
    }
    if (segmentStart === -1) return []

    // 2. Buscar Chapters dentro del Segment. Si aparece un Cluster antes, se abandona:
    // los metadatos van antes del video en cualquier mux normal, y seguir leyendo
    // significaría recorrer gigabytes de datos de imagen.
    let chaptersRange: { start: number; end: number } | null = null

    walkChildren(buf, segmentStart, segmentEnd, (id, payloadStart, payloadEnd) => {
      if (id === IDS.Chapters) {
        chaptersRange = { start: payloadStart, end: payloadEnd }
        return 'stop'
      }
      if (id === IDS.Cluster) return 'stop'
    })

    if (!chaptersRange) return []
    const { start: chaptersStart, end: chaptersEnd } = chaptersRange

    // 3. Chapters > EditionEntry > ChapterAtom > (tiempos + ChapterDisplay > ChapString)
    const chapters: RawChapter[] = []

    walkChildren(buf, chaptersStart, chaptersEnd, (editionId, editionStart, editionEnd) => {
      if (editionId !== IDS.EditionEntry) return

      walkChildren(buf, editionStart, editionEnd, (atomId, atomStart, atomEnd) => {
        if (atomId !== IDS.ChapterAtom) return

        let startTicks: bigint | null = null
        let endTicks: bigint | null = null
        const titles: string[] = []

        walkChildren(buf, atomStart, atomEnd, (fieldId, fieldStart, fieldEnd) => {
          if (fieldId === IDS.ChapterTimeStart) {
            startTicks = readUint(buf, fieldStart, fieldEnd)
          } else if (fieldId === IDS.ChapterTimeEnd) {
            endTicks = readUint(buf, fieldStart, fieldEnd)
          } else if (fieldId === IDS.ChapterDisplay) {
            walkChildren(buf, fieldStart, fieldEnd, (displayId, displayStart, displayEnd) => {
              if (displayId === IDS.ChapString) {
                titles.push(decodeUtf8(buf, displayStart, displayEnd))
              }
            })
          }
        })

        if (startTicks !== null) {
          chapters.push({
            startSeconds: Number(startTicks) / NANOSECONDS_PER_SECOND,
            endSeconds: endTicks !== null ? Number(endTicks) / NANOSECONDS_PER_SECOND : null,
            titles
          })
        }
      })
    })

    return chapters
  } catch {
    return []
  }
}

export type ChapterRole = 'intro' | 'outro' | 'other'

/**
 * Los capítulos genéricos ("Chapter 01") no dicen nada: solo se reconocen los nombres
 * convencionales de intro y créditos, habituales en anime y en rips cuidados.
 */
export function classifyChapterTitle(title: string): ChapterRole {
  const normalized = title.trim()
  if (/^(op|opening|intro)\b/i.test(normalized)) return 'intro'
  if (/^(ed|ending|outro|cr[eé]ditos?|credits)\b/i.test(normalized)) return 'outro'
  return 'other'
}

export interface ChapterMarksResult {
  introEndSeconds?: number
  outroStartSeconds?: number
}

export function findChapterMarks(chapters: RawChapter[]): ChapterMarksResult {
  const marks: ChapterMarksResult = {}

  chapters.forEach((chapter, index) => {
    const role = chapter.titles.map(classifyChapterTitle).find((r) => r !== 'other')

    if (role === 'intro' && marks.introEndSeconds === undefined) {
      // Si el capítulo no declara fin, sirve el inicio del siguiente.
      const end = chapter.endSeconds ?? chapters[index + 1]?.startSeconds
      if (end !== undefined && end > 0) marks.introEndSeconds = end
    }
    if (role === 'outro') {
      marks.outroStartSeconds = chapter.startSeconds
    }
  })

  return marks
}
