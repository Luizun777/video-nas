import { describe, expect, it } from 'vitest'
import { findSubtitleCandidates } from '../src/core/playback/subtitle-candidates'

describe('findSubtitleCandidates', () => {
  it('mismo basename, con y sin sufijo de idioma', () => {
    const result = findSubtitleCandidates({
      videoFileName: 'La.Peli.2020.1080p.mkv',
      dirEntries: [
        'La.Peli.2020.1080p.mkv',
        'La.Peli.2020.1080p.srt',
        'La.Peli.2020.1080p.es.srt',
        'Otra.Cosa.srt'
      ]
    })
    expect(result.map((r) => r.relPath)).toEqual(['La.Peli.2020.1080p.srt', 'La.Peli.2020.1080p.es.srt'])
    expect(result[1].language).toBe('es')
  })

  it('todo lo de Subs/ pertenece al título', () => {
    const result = findSubtitleCandidates({
      videoFileName: 'movie.mkv',
      dirEntries: ['movie.mkv'],
      subsDirEntries: [{ dir: 'Subs', names: ['2_Spanish.srt', '3_English.ass', 'nota.txt'] }]
    })
    expect(result.map((r) => r.relPath)).toEqual(['Subs/2_Spanish.srt', 'Subs/3_English.ass'])
  })

  it('un único srt suelto cuenta como del video; varios sueltos no se adivinan', () => {
    const unico = findSubtitleCandidates({
      videoFileName: 'pelicula.avi',
      dirEntries: ['pelicula.avi', 'subtitulos.srt']
    })
    expect(unico.map((r) => r.relPath)).toEqual(['subtitulos.srt'])

    const varios = findSubtitleCandidates({
      videoFileName: 'e01.mkv',
      dirEntries: ['e01.mkv', 'e02.srt', 'e03.srt']
    })
    expect(varios).toEqual([])
  })

  it('sufijos raros no se toman por idioma', () => {
    const result = findSubtitleCandidates({
      videoFileName: 'La Peli.mkv',
      dirEntries: ['La Peli.mkv', 'La Peli.v2.srt']
    })
    expect(result[0].language).toBeUndefined()
  })

  it('acentos en los nombres no rompen el emparejamiento', () => {
    const result = findSubtitleCandidates({
      videoFileName: 'Amélie (2001).mkv',
      dirEntries: ['Amélie (2001).mkv', 'Amélie (2001).spa.srt']
    })
    expect(result).toHaveLength(1)
    expect(result[0].language).toBe('spa')
  })
})
