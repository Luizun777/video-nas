import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { parseFfprobeJson } from '@core/playback/media-probe'
import type { MediaProbe } from '@shared/types'

const exec = promisify(execFile)

/**
 * Rutas de los binarios empaquetados. Dentro del .app viven en app.asar.unpacked
 * (electron-builder.yml los desempaqueta: un binario dentro del asar no es ejecutable);
 * en desarrollo el replace no encuentra nada y deja la ruta tal cual.
 */
function unpacked(binPath: string): string {
  return binPath.replace('app.asar', 'app.asar.unpacked')
}

export function ffmpegBinary(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static no trae binario para esta plataforma.')
  return unpacked(ffmpegPath)
}

export function ffprobeBinary(): string {
  return unpacked(ffprobeInstaller.path)
}

/**
 * Un fotograma en el segundo pedido, como data URL, para la vista previa de la barra.
 * `-ss` ANTES de `-i` para que ffmpeg salte por keyframes (instantáneo aunque el
 * archivo tenga varios GB) y una sola imagen pequeña para que quepa en el IPC.
 */
export async function previewFrame(absPath: string, seconds: number): Promise<string | null> {
  try {
    const { stdout } = await exec(
      ffmpegBinary(),
      [
        '-v', 'error',
        '-ss', String(Math.max(0, Math.floor(seconds))),
        '-i', absPath,
        '-frames:v', '1',
        '-vf', 'scale=320:-2',
        '-f', 'mjpeg',
        'pipe:1'
      ],
      { maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' }
    )
    const buffer = stdout as unknown as Buffer
    if (!buffer || buffer.length === 0) return null
    return `data:image/jpeg;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

/** Streams reales del archivo (códecs, idiomas, default) + duración. */
export async function probeMedia(absPath: string): Promise<MediaProbe> {
  const { stdout } = await exec(
    ffprobeBinary(),
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', absPath],
    { maxBuffer: 16 * 1024 * 1024 }
  )
  return parseFfprobeJson(stdout)
}
