import { describe, expect, it } from 'vitest'
import { decidePlaybackPlan, parseFfprobeJson } from '../src/core/playback/media-probe'

// Fixtures recortados de salidas reales de `ffprobe -print_format json -show_streams
// -show_format` (solo los campos que el parser usa).

function ffprobeJson(streams: object[], duration = '5400.5'): string {
  return JSON.stringify({ streams, format: { duration } })
}

const H264 = { index: 0, codec_type: 'video', codec_name: 'h264', disposition: { default: 1 } }
const HEVC = { index: 0, codec_type: 'video', codec_name: 'hevc', disposition: { default: 1 } }
const DIVX = { index: 0, codec_type: 'video', codec_name: 'mpeg4', disposition: { default: 0 } }
const MPEG2 = { index: 0, codec_type: 'video', codec_name: 'mpeg2video', disposition: {} }

const AAC_ES = {
  index: 1,
  codec_type: 'audio',
  codec_name: 'aac',
  channels: 2,
  tags: { language: 'spa', title: 'Español Latino' },
  disposition: { default: 1 }
}
const AC3_LAT = {
  index: 1,
  codec_type: 'audio',
  codec_name: 'ac3',
  channels: 6,
  tags: { language: 'spa' },
  disposition: { default: 1 }
}
const DTS = {
  index: 1,
  codec_type: 'audio',
  codec_name: 'dts',
  channels: 6,
  tags: { language: 'eng' },
  disposition: { default: 1 }
}
const MP3 = { index: 1, codec_type: 'audio', codec_name: 'mp3', channels: 2, disposition: {} }
const SUB_SRT = {
  index: 2,
  codec_type: 'subtitle',
  codec_name: 'subrip',
  tags: { language: 'spa' },
  disposition: {}
}
const SUB_PGS = {
  index: 3,
  codec_type: 'subtitle',
  codec_name: 'hdmv_pgs_subtitle',
  tags: { language: 'eng' },
  disposition: {}
}

describe('parseFfprobeJson', () => {
  it('normaliza streams con idioma, canales y default', () => {
    const probe = parseFfprobeJson(ffprobeJson([H264, AC3_LAT, SUB_SRT, SUB_PGS]))
    expect(probe.durationSec).toBeCloseTo(5400.5)
    expect(probe.streams).toHaveLength(4)
    expect(probe.streams[1]).toMatchObject({
      index: 1,
      type: 'audio',
      codec: 'ac3',
      language: 'spa',
      channels: 6,
      isDefault: true
    })
    expect(probe.streams[3].codec).toBe('hdmv_pgs_subtitle')
  })

  it('JSON corrupto o vacío no revienta', () => {
    expect(parseFfprobeJson('{nope')).toEqual({ durationSec: 0, streams: [] })
    expect(parseFfprobeJson('{}').streams).toEqual([])
  })
})

describe('decidePlaybackPlan', () => {
  it('H264+AAC y HEVC+MP3 van directo', () => {
    expect(decidePlaybackPlan(parseFfprobeJson(ffprobeJson([H264, AAC_ES])))).toMatchObject({
      mode: 'direct'
    })
    expect(decidePlaybackPlan(parseFfprobeJson(ffprobeJson([HEVC, MP3])))).toMatchObject({
      mode: 'direct'
    })
  })

  it('AC3 copia el video y recodifica solo el audio (Chromium no decodifica AC3)', () => {
    const plan = decidePlaybackPlan(parseFfprobeJson(ffprobeJson([HEVC, AC3_LAT])))
    expect(plan).toMatchObject({ mode: 'transcode', videoCopy: true })
    expect(plan.reason).toContain('ac3')
  })

  it('DivX y MPEG-2 transcodifican el video completo', () => {
    const divx = decidePlaybackPlan(parseFfprobeJson(ffprobeJson([DIVX, MP3])))
    expect(divx).toMatchObject({ mode: 'transcode', videoCopy: false })
    const mpeg2 = decidePlaybackPlan(parseFfprobeJson(ffprobeJson([MPEG2, MP3])))
    expect(mpeg2.mode).toBe('transcode')
  })

  it('H264+DTS copia el video y solo recodifica el audio', () => {
    const plan = decidePlaybackPlan(parseFfprobeJson(ffprobeJson([H264, DTS])))
    expect(plan).toMatchObject({ mode: 'transcode', videoCopy: true })
    expect(plan.reason).toContain('dts')
  })

  it('el audio DEFAULT manda: DTS default con AAC alterno también transcodifica', () => {
    const aacAlt = { ...AAC_ES, index: 2, disposition: { default: 0 } }
    const plan = decidePlaybackPlan(parseFfprobeJson(ffprobeJson([H264, DTS, aacAlt])))
    expect(plan.mode).toBe('transcode')
    expect(plan.videoCopy).toBe(true)
  })

  it('sin audio no se transcodifica por audio; sin video tampoco por video', () => {
    expect(decidePlaybackPlan(parseFfprobeJson(ffprobeJson([H264]))).mode).toBe('direct')
    expect(decidePlaybackPlan(parseFfprobeJson(ffprobeJson([AAC_ES]))).mode).toBe('direct')
  })
})
