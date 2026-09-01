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

/** Streams reales del archivo (códecs, idiomas, default) + duración. */
export async function probeMedia(absPath: string): Promise<MediaProbe> {
  const { stdout } = await exec(
    ffprobeBinary(),
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', absPath],
    { maxBuffer: 16 * 1024 * 1024 }
  )
  return parseFfprobeJson(stdout)
}
