import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { ffmpegBinary } from './ffmpeg'

/**
 * Transcodificación al vuelo para lo que Chromium no decodifica (DivX, MPEG-2, DTS…):
 * ffmpeg lee desde -ss y escupe fMP4 (H.264 recodificado o copia + AAC estéreo) por
 * stdout, servido como stream NO buscable por videofile://transcode. El seek lo finge
 * el motor del renderer: mata la sesión y arranca otra en la nueva posición.
 *
 * Una sola sesión viva por dueño (la app de escritorio, o cada navegador de la LAN):
 * abrir la siguiente mata la anterior de ese mismo dueño. La
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
  /** Quién la pide: 'desktop' o 'lan:<ip>'. Default: 'desktop'. */
  owner?: string
}

interface Session {
  id: string
  owner: string
  proc: ChildProcessByStdio<null, Readable, null>
  taken: boolean
}

const sessions = new Map<string, Session>()

/** H.264 por hardware (VideoToolbox) solo existe en macOS; en Windows, x264 por software. */
const VIDEO_ENCODE_ARGS =
  process.platform === 'darwin'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p']

export function startTranscodeSession(options: TranscodeOptions): { sessionId: string } {
  const owner = options.owner ?? 'desktop'
  for (const session of [...sessions.values()]) {
    if (session.owner === owner) stopTranscodeSession(session.id)
  }

  const args = ['-v', 'error', '-nostdin']
  if (options.startAt > 0) args.push('-ss', String(options.startAt))
  args.push('-i', options.absPath, '-map', '0:v:0?')
  args.push('-map', options.audioStreamIndex !== undefined ? `0:${options.audioStreamIndex}` : '0:a:0?')
  if (options.videoCopy) {
    args.push('-c:v', 'copy')
  } else {
    args.push(...VIDEO_ENCODE_ARGS)
  }
  args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k')
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1')

  const proc = spawn(ffmpegBinary(), args, { stdio: ['ignore', 'pipe', 'ignore'] })
  const id = randomUUID()
  sessions.set(id, { id, owner, proc, taken: false })
  proc.on('exit', () => sessions.delete(id))
  return { sessionId: id }
}

/** El stdout se entrega UNA sola vez (un único consumidor: la respuesta del protocolo). */
export function takeSessionStream(sessionId: string): Readable | null {
  const session = sessions.get(sessionId)
  if (!session || session.taken) return null
  session.taken = true
  return session.proc.stdout
}

/** Sin sessionId mata todas (al salir de la app). */
export function stopTranscodeSession(sessionId?: string): void {
  const targets = sessionId ? [sessions.get(sessionId)] : [...sessions.values()]
  for (const session of targets) {
    if (!session) continue
    session.proc.kill('SIGKILL')
    sessions.delete(session.id)
  }
}
