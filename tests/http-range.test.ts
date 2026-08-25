import { describe, expect, it } from 'vitest'
import { mimeForPath, parseRange } from '../src/core/playback/http-range'

// Este contrato lo implementan DOS servidores: videofile:// (desktop) y el puente
// HTTP de Android (StreamServer.kt). Los casos de aquí son la referencia de ambos.

describe('parseRange', () => {
  const SIZE = 4096

  it('sin cabecera devuelve null', () => {
    expect(parseRange(null, SIZE)).toBeNull()
  })

  it('rango cerrado bytes=a-b', () => {
    expect(parseRange('bytes=0-1023', SIZE)).toEqual({ start: 0, end: 1023 })
  })

  it('rango abierto por la derecha bytes=a-', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: SIZE - 1 })
  })

  it('sufijo bytes=-N son los últimos N bytes', () => {
    expect(parseRange('bytes=-500', SIZE)).toEqual({ start: SIZE - 500, end: SIZE - 1 })
  })

  it('sufijo mayor que el archivo arranca en 0', () => {
    expect(parseRange('bytes=-9999', 300)).toEqual({ start: 0, end: 299 })
  })

  it('recorta el fin al tamaño del archivo', () => {
    expect(parseRange('bytes=0-999999', 100)).toEqual({ start: 0, end: 99 })
  })

  it('tolera espacios alrededor de la cabecera', () => {
    expect(parseRange('  bytes=0-1  ', SIZE)).toEqual({ start: 0, end: 1 })
  })

  it('inválidos devuelven null (el servidor responde 416)', () => {
    expect(parseRange('bytes=', SIZE)).toBeNull()
    expect(parseRange('bytes=-0', SIZE)).toBeNull()
    expect(parseRange('bytes=abc-def', SIZE)).toBeNull()
    expect(parseRange('octets=0-100', SIZE)).toBeNull()
    expect(parseRange('bytes=5-2', SIZE)).toBeNull()
    expect(parseRange('bytes=0-100,200-300', SIZE)).toBeNull()
  })

  it('start más allá del archivo devuelve null', () => {
    expect(parseRange(`bytes=${SIZE}-`, SIZE)).toBeNull()
  })
})

describe('mimeForPath', () => {
  it('resuelve extensiones de video conocidas', () => {
    expect(mimeForPath('/nas/Movies/Avatar (2009)/Avatar.mkv')).toBe('video/x-matroska')
    expect(mimeForPath('pelicula.mp4')).toBe('video/mp4')
    expect(mimeForPath('viejo.avi')).toBe('video/x-msvideo')
  })

  it('ignora mayúsculas en la extensión', () => {
    expect(mimeForPath('PELICULA.MP4')).toBe('video/mp4')
  })

  it('desconocidas o sin extensión → octet-stream', () => {
    expect(mimeForPath('archivo.xyz')).toBe('application/octet-stream')
    expect(mimeForPath('sin-extension')).toBe('application/octet-stream')
  })
})
