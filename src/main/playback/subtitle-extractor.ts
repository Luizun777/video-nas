import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ffmpegBinary } from './ffmpeg'

const exec = promisify(execFile)
const MAX_VTT_BYTES = 64 * 1024 * 1024

/**
 * Convierte subtítulos a WebVTT con ffmpeg, a memoria (pipe). Chromium solo renderiza
 * <track> WebVTT: los SubRip/ASS embebidos o sueltos pasan por aquí. PGS/VobSub son
 * bitmaps y no se convierten (el menú los marca como no disponibles).
 */
async function runToVtt(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec(ffmpegBinary(), ['-v', 'error', ...args, '-f', 'webvtt', 'pipe:1'], {
      maxBuffer: MAX_VTT_BYTES
    })
    return stdout
  } catch {
    return null
  }
}

/** Pista embebida por índice GLOBAL de stream (el mismo que reporta ffprobe). */
export async function extractEmbeddedSubtitle(
  absPath: string,
  streamIndex: number
): Promise<string | null> {
  return runToVtt(['-i', absPath, '-map', `0:${streamIndex}`])
}

/** .srt/.ass externo. Muchos rips en español vienen en CP1252: segundo intento con esa
 *  codificación cuando el archivo no es UTF-8 válido (ffmpeg falla o deja mojibake). */
export async function convertSubtitleFile(absPath: string): Promise<string | null> {
  const utf8 = await runToVtt(['-i', absPath])
  if (utf8 !== null && !utf8.includes('�')) return utf8
  const cp1252 = await runToVtt(['-sub_charenc', 'CP1252', '-i', absPath])
  return cp1252 ?? utf8
}
