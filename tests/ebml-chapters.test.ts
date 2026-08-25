import { describe, it, expect } from 'vitest'
import {
  classifyChapterTitle,
  findChapterMarks,
  parseChaptersFromBuffer,
  type RawChapter
} from '../src/main/playback/ebml-chapters'

// ---------------------------------------------------------------------------
// Constructor mínimo de bytes EBML, para no depender de archivos MKV de prueba.
// ---------------------------------------------------------------------------

/** Codifica un tamaño como vint EBML de longitud mínima (con su bit marcador). */
function encodeSize(value: number): number[] {
  if (value < 0x80 - 1) return [0x80 | value]
  if (value < 0x4000 - 1) return [0x40 | (value >> 8), value & 0xff]
  if (value < 0x200000 - 1) return [0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff]
  throw new Error('Tamaño fuera del alcance del builder de test')
}

function element(id: number[], payload: number[]): number[] {
  return [...id, ...encodeSize(payload.length), ...payload]
}

function uintPayload(value: number, bytes = 8): number[] {
  const out: number[] = []
  for (let i = bytes - 1; i >= 0; i--) {
    out.push(Number((BigInt(value) >> BigInt(i * 8)) & 0xffn))
  }
  return out
}

function stringPayload(text: string): number[] {
  return [...new TextEncoder().encode(text)]
}

const ID = {
  Segment: [0x18, 0x53, 0x80, 0x67],
  Chapters: [0x10, 0x43, 0xa7, 0x70],
  EditionEntry: [0x45, 0xb9],
  ChapterAtom: [0xb6],
  ChapterTimeStart: [0x91],
  ChapterTimeEnd: [0x92],
  ChapterDisplay: [0x80],
  ChapString: [0x85],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Void: [0xec]
}

const SECOND = 1_000_000_000

function chapterAtom(startNs: number, endNs: number | null, title?: string): number[] {
  const fields = [...element(ID.ChapterTimeStart, uintPayload(startNs))]
  if (endNs !== null) fields.push(...element(ID.ChapterTimeEnd, uintPayload(endNs)))
  if (title !== undefined) {
    fields.push(...element(ID.ChapterDisplay, element(ID.ChapString, stringPayload(title))))
  }
  return element(ID.ChapterAtom, fields)
}

function mkvWithChapters(atoms: number[][]): Uint8Array {
  const edition = element(ID.EditionEntry, atoms.flat())
  const chapters = element(ID.Chapters, edition)
  return new Uint8Array(element(ID.Segment, chapters))
}

// ---------------------------------------------------------------------------

describe('parseChaptersFromBuffer', () => {
  it('extrae capítulos con su título y tiempos en segundos', () => {
    const buf = mkvWithChapters([
      chapterAtom(0, 90 * SECOND, 'Opening'),
      chapterAtom(90 * SECOND, 1400 * SECOND, 'Episodio'),
      chapterAtom(1400 * SECOND, 1440 * SECOND, 'Ending')
    ])

    const chapters = parseChaptersFromBuffer(buf)
    expect(chapters).toHaveLength(3)
    expect(chapters[0]).toEqual({ startSeconds: 0, endSeconds: 90, titles: ['Opening'] })
    expect(chapters[2].startSeconds).toBe(1400)
  })

  it('un capítulo sin ChapterTimeEnd deja endSeconds en null', () => {
    const chapters = parseChaptersFromBuffer(mkvWithChapters([chapterAtom(10 * SECOND, null, 'OP')]))
    expect(chapters[0]).toEqual({ startSeconds: 10, endSeconds: null, titles: ['OP'] })
  })

  it('un Segment sin Chapters devuelve lista vacía', () => {
    const buf = new Uint8Array(element(ID.Segment, element(ID.Void, [0, 0, 0, 0])))
    expect(parseChaptersFromBuffer(buf)).toEqual([])
  })

  it('abandona al encontrar un Cluster: los capítulos nunca van tras el video', () => {
    // Cluster primero, Chapters después: el parser NO debe recorrer el video buscando.
    const cluster = element(ID.Cluster, [0x00, 0x01, 0x02, 0x03])
    const chapters = element(ID.Chapters, element(ID.EditionEntry, chapterAtom(0, SECOND, 'OP')))
    const buf = new Uint8Array(element(ID.Segment, [...cluster, ...chapters]))
    expect(parseChaptersFromBuffer(buf)).toEqual([])
  })

  it('un buffer truncado a la mitad no lanza', () => {
    const full = mkvWithChapters([chapterAtom(0, 90 * SECOND, 'Opening')])
    const truncated = full.subarray(0, Math.floor(full.length / 2))
    expect(() => parseChaptersFromBuffer(truncated)).not.toThrow()
    expect(parseChaptersFromBuffer(truncated)).toEqual([])
  })

  it('un buffer vacío o basura no lanza', () => {
    expect(parseChaptersFromBuffer(new Uint8Array([]))).toEqual([])
    expect(parseChaptersFromBuffer(new Uint8Array([0x00, 0x00, 0x00]))).toEqual([])
    expect(parseChaptersFromBuffer(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toEqual([])
  })

  it('lee títulos con acentos (UTF-8)', () => {
    const chapters = parseChaptersFromBuffer(
      mkvWithChapters([chapterAtom(0, SECOND, 'Introducción')])
    )
    expect(chapters[0].titles).toEqual(['Introducción'])
  })
})

describe('classifyChapterTitle', () => {
  it.each(['OP', 'Opening', 'opening credits', 'Intro', 'INTRO'])('%s -> intro', (title) => {
    expect(classifyChapterTitle(title)).toBe('intro')
  })

  it.each(['ED', 'Ending', 'Outro', 'Créditos', 'creditos', 'Credits'])('%s -> outro', (title) => {
    expect(classifyChapterTitle(title)).toBe('outro')
  })

  it.each(['Chapter 01', 'Capítulo 3', 'Parte 2', 'Prólogo'])('%s -> other', (title) => {
    expect(classifyChapterTitle(title)).toBe('other')
  })
})

describe('findChapterMarks', () => {
  it('deriva el fin del intro y el inicio de los créditos', () => {
    const chapters: RawChapter[] = [
      { startSeconds: 0, endSeconds: 90, titles: ['Opening'] },
      { startSeconds: 90, endSeconds: 1400, titles: ['Episodio'] },
      { startSeconds: 1400, endSeconds: 1440, titles: ['Ending'] }
    ]
    expect(findChapterMarks(chapters)).toEqual({ introEndSeconds: 90, outroStartSeconds: 1400 })
  })

  it('si el capítulo de intro no declara fin, usa el inicio del siguiente', () => {
    const chapters: RawChapter[] = [
      { startSeconds: 0, endSeconds: null, titles: ['OP'] },
      { startSeconds: 85, endSeconds: null, titles: ['Parte A'] }
    ]
    expect(findChapterMarks(chapters).introEndSeconds).toBe(85)
  })

  it('capítulos genéricos sin nombre reconocible no producen marcas', () => {
    // Caso real: "La Era de Hielo (2002).mkv" trae capítulos "Chapter 01", "Chapter 02"...
    const chapters: RawChapter[] = [
      { startSeconds: 0, endSeconds: 300, titles: ['Chapter 01'] },
      { startSeconds: 300, endSeconds: 600, titles: ['Chapter 02'] }
    ]
    expect(findChapterMarks(chapters)).toEqual({})
  })

  it('sin capítulos no hay marcas', () => {
    expect(findChapterMarks([])).toEqual({})
  })
})
