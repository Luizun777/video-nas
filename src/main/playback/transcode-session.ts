import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { ffmpegBinary } from './ffmpeg'

/**
 * Transcodificación al vuelo para lo que Chromium no decodifica (DivX, MPEG-2, DTS…):
 * ffmpeg lee desde -ss y escupe fMP4 (H.264 VideoToolbox o copia + AAC estéreo) por
 * stdout, servido como stream NO buscable por videofile://transcode. El seek lo finge
 * el motor del renderer: mata la sesión y arranca otra en la nueva posición.
 *
 * Una sola sesión viva por proceso: abrir la siguiente mata la anterior. La
 * contrapresión llega sola (pipe → ReadableStream pull); la cancelación NO — el
 * protocolo envuelve el stream y su cancel() llama a stopTranscodeSession().
 */

export interface TranscodeOptions {
  absPath: string
  startAt: number
  /** Índice GLOBAL del stream de audio a usar; sin él, el primero (0:a:0). */
  audioStreamIndex?: number
  /** true = solo el audio es el problema: el video se copia sin recodificar. */
  videoCopy: boolean
}

interface Session {
  id: string
  proc: ChildProcessByStdio<null, Readable, null>
  taken: boolean
}

let current: Session | null = null

export function startTranscodeSession(options: TranscodeOptions): { sessionId: string } {
  stopTranscodeSession()

  const args = ['-v', 'error', '-nostdin']
  if (options.startAt > 0) args.push('-ss', String(options.startAt))
  args.push('-i', options.absPath, '-map', '0:v:0?')
  args.push('-map', options.audioStreamIndex !== undefined ? `0:${options.audioStreamIndex}` : '0:a:0?')
  if (options.videoCopy) {
    args.push('-c:v', 'copy')
  } else {
    args.push('-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p')
  }
  args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k')
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1')

  const proc = spawn(ffmpegBinary(), args, { stdio: ['ignore', 'pipe', 'ignore'] })
  const id = randomUUID()
  current = { id, proc, taken: false }
  return { sessionId: id }
}

/** El stdout se entrega UNA sola vez (un único consumidor: la respuesta del protocolo). */
export function takeSessionStream(sessionId: string): Readable | null {
  if (!current || current.id !== sessionId || current.taken) return null
  current.taken = true
  return current.proc.stdout
}

export function stopTranscodeSession(sessionId?: string): void {
  if (!current) return
  if (sessionId && current.id !== sessionId) return
  current.proc.kill('SIGKILL')
  current = null
}
