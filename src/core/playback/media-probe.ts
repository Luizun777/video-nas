import type { MediaProbe, PlaybackPlan, ProbeStream } from '@shared/types'

// Decisión directo-vs-transcode del desktop, pura para poder testearla con JSONs
// reales de ffprobe. El main de Electron corre ffprobe y pasa el JSON crudo aquí.

/** Lo que Chromium en esta Mac decodifica por hardware/sistema. */
const SUPPORTED_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1'])

/**
 * Audio que sí suena en el <video> de macOS. AC3/EAC3 van incluidos a propósito:
 * a diferencia de Android, macOS le presta sus decodificadores al sistema
 * (verificado con los rips Dual-Lat reales — ver CLAUDE.md).
 */
const SUPPORTED_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'])

function isSupportedAudio(codec: string): boolean {
  return SUPPORTED_AUDIO.has(codec) || codec.startsWith('pcm_')
}

/** Para decidir si, ante un fallo, basta con recodificar el audio y COPIAR el video. */
export function isSupportedVideoCodec(codec: string): boolean {
  return SUPPORTED_VIDEO.has(codec)
}

interface FfprobeStreamJson {
  index?: number
  codec_type?: string
  codec_name?: string
  channels?: number
  tags?: { language?: string; title?: string }
  disposition?: { default?: number }
}

interface FfprobeJson {
  streams?: FfprobeStreamJson[]
  format?: { duration?: string }
}

/** Normaliza la salida de `ffprobe -show_streams -show_format -print_format json`. */
export function parseFfprobeJson(raw: string): MediaProbe {
  let parsed: FfprobeJson
  try {
    parsed = JSON.parse(raw) as FfprobeJson
  } catch {
    return { durationSec: 0, streams: [] }
  }

  const streams: ProbeStream[] = []
  for (const stream of parsed.streams ?? []) {
    const type = stream.codec_type
    if (type !== 'video' && type !== 'audio' && type !== 'subtitle') continue
    streams.push({
      index: stream.index ?? streams.length,
      type,
      codec: stream.codec_name ?? 'desconocido',
      language: stream.tags?.language,
      title: stream.tags?.title,
      channels: stream.channels,
      isDefault: stream.disposition?.default === 1
    })
  }

  const durationSec = Number(parsed.format?.duration ?? 0)
  return { durationSec: Number.isFinite(durationSec) ? durationSec : 0, streams }
}

/**
 * Directo salvo que el códec no vaya a sonar/verse:
 *  - Video no soportado (DivX/XviD, MPEG-2…) → transcode completo.
 *  - Video bien pero el audio por defecto no decodifica (DTS…) → transcode copiando
 *    el video (rápido y sin perder calidad; solo se recodifica el audio a AAC).
 * Con cero streams de audio (o de video) no se transcodifica por eso.
 */
export function decidePlaybackPlan(probe: MediaProbe): PlaybackPlan {
  const video = probe.streams.find((s) => s.type === 'video')
  const audios = probe.streams.filter((s) => s.type === 'audio')

  if (video && !SUPPORTED_VIDEO.has(video.codec)) {
    return { mode: 'transcode', videoCopy: false, reason: `video ${video.codec}` }
  }

  if (audios.length > 0) {
    const defaultAudio = audios.find((s) => s.isDefault) ?? audios[0]
    if (!isSupportedAudio(defaultAudio.codec)) {
      return { mode: 'transcode', videoCopy: true, reason: `audio ${defaultAudio.codec}` }
    }
  }

  return { mode: 'direct', videoCopy: false }
}
