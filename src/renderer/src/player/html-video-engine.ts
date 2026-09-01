import { transcodeSessionUrl, videoStreamUrl } from '@shared/playback-url'
import type {
  MediaProbe,
  MediaTrack,
  PlaybackPlan,
  ProbeStream,
  SubtitleFileInfo,
  TrackSet
} from '@shared/types'
import { isSupportedVideoCodec } from '@core/playback/media-probe'
import type {
  EngineCaps,
  EngineError,
  EngineEvent,
  EngineLoadTarget,
  EngineState,
  PlaybackEngine
} from './engine'

const UNSUPPORTED_CHECK_INTERVAL_MS = 4000
/** Strikes consecutivos con audio en 0 bytes antes de decidir "pista no soportada". */
const SILENT_AUDIO_STRIKES = 2

/** Cuenta acumulada de bytes de audio decodificados: Chromium-only, no estándar. */
type VideoWithAudioByteCount = HTMLVideoElement & { webkitAudioDecodedByteCount?: number }

/** video.audioTracks existe con la blink feature AudioVideoTracks (main la activa). */
interface ChromiumAudioTrack {
  id: string
  enabled: boolean
}
type VideoWithAudioTracks = HTMLVideoElement & {
  audioTracks?: { length: number; [index: number]: ChromiumAudioTrack }
}

/** Subtítulos de texto convertibles a WebVTT; el resto (PGS/VobSub) son bitmaps. */
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'])

const LANGUAGE_LABELS: Record<string, string> = {
  es: 'Español', spa: 'Español', esp: 'Español', lat: 'Español latino', mx: 'Español latino',
  en: 'Inglés', eng: 'Inglés', ing: 'Inglés',
  ja: 'Japonés', jpn: 'Japonés', fr: 'Francés', fre: 'Francés', fra: 'Francés',
  de: 'Alemán', ger: 'Alemán', it: 'Italiano', ita: 'Italiano',
  pt: 'Portugués', por: 'Portugués', und: ''
}

function languageLabel(language?: string): string {
  if (!language) return ''
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language
}

function channelsLabel(channels?: number): string {
  if (!channels) return ''
  if (channels >= 8) return '7.1'
  if (channels >= 6) return '5.1'
  if (channels === 2) return 'estéreo'
  if (channels === 1) return 'mono'
  return `${channels}ch`
}

function audioLabel(stream: ProbeStream, position: number): string {
  const base = stream.title || languageLabel(stream.language) || `Pista ${position + 1}`
  const extra = [stream.codec.toUpperCase(), channelsLabel(stream.channels)].filter(Boolean).join(' ')
  return extra ? `${base} (${extra})` : base
}

function subtitleLabel(stream: ProbeStream, position: number): string {
  return stream.title || languageLabel(stream.language) || `Subtítulos ${position + 1}`
}

/**
 * Motor sobre el <video> de Chromium (desktop). Con window.api.probeMedia disponible,
 * cada carga pasa por ffprobe: lo que Chromium no decodifica (DivX, MPEG-2, DTS…)
 * arranca directamente en una sesión de transcode (fMP4 por videofile://transcode) en
 * vez de dejar pantalla negra. El seek en transcode se finge: se mata la sesión y se
 * relanza con -ss, y currentTime visible = offset de la sesión + tiempo del elemento.
 *
 * El watchdog de códecs queda como red de seguridad (falsos negativos del plan):
 * un solo reintento en transcode, y solo si eso también falla se cae al externo.
 */
export class HtmlVideoEngine implements PlaybackEngine {
  readonly caps: EngineCaps = {
    pip: true,
    htmlFullscreen: true,
    rendersVideoInDom: true,
    nativeSubtitles: false
  }

  private el: HTMLVideoElement | null = null
  private target: EngineLoadTarget | null = null
  private volume = 1
  private listeners = new Map<EngineEvent, Set<() => void>>()
  private errorListeners = new Set<(error: EngineError) => void>()
  private domCleanup: (() => void) | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private unsupportedFired = false
  private silentAudioStrikes = 0
  private lastAudioCheckTime = 0

  /** Sube en cada load(): los pasos async abandonan si el target ya cambió. */
  private loadSeq = 0
  private probe: MediaProbe | null = null
  private plan: PlaybackPlan | null = null
  private mode: 'direct' | 'transcode' = 'direct'
  private transcode: { sessionId: string; offset: number } | null = null
  private transcodeRetried = false
  /** Índice GLOBAL del stream de audio elegido (null = el default del archivo). */
  private selectedAudioIndex: number | null = null
  private externalSubs: SubtitleFileInfo[] = []
  private activeSubtitleId: string | null = null
  private trackEl: HTMLTrackElement | null = null
  private trackBlobUrl: string | null = null
  /** Descarta VTT que llegan tarde tras cambiar de pista. */
  private subtitleSeq = 0

  get videoElement(): HTMLVideoElement | null {
    return this.el
  }

  attachMedia(el: HTMLVideoElement | null): void {
    if (el === this.el) return
    this.domCleanup?.()
    this.domCleanup = null
    this.el = el
    if (!el) return

    el.volume = this.volume
    // OJO: nada de crossOrigin aquí. El esquema videofile:// no está registrado con
    // corsEnabled, así que marcar el <video> como cross-origin hace que Chromium
    // rechace TODOS los formatos con "Format error". Los subtítulos evitan el problema
    // viajando por IPC y montándose como blob: (mismo origen).

    const emit = (event: EngineEvent) => (): void => this.emit(event)
    const onPlay = emit('play')
    const onPause = emit('pause')
    const onTimeUpdate = emit('timeupdate')
    const onDurationChange = emit('durationchange')
    const onEnded = emit('ended')
    const onLoadedMetadata = (): void => {
      // En transcode el offset ya viene aplicado con -ss; esto es solo para directo.
      const startAt = this.target?.startAt
      if (this.mode === 'direct' && startAt && startAt > 0 && startAt < el.duration) {
        el.currentTime = startAt
      }
      this.emit('durationchange')
    }
    const onError = (): void => this.handleCodecProblem(false)

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('durationchange', onDurationChange)
    el.addEventListener('ended', onEnded)
    el.addEventListener('loadedmetadata', onLoadedMetadata)
    el.addEventListener('error', onError)
    this.domCleanup = () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('durationchange', onDurationChange)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('loadedmetadata', onLoadedMetadata)
      el.removeEventListener('error', onError)
    }

    if (this.target) void this.prepareAndLoad()
  }

  load(target: EngineLoadTarget): void {
    this.target = target
    this.loadSeq += 1
    this.stopActiveTranscode()
    this.transcodeRetried = false
    this.selectedAudioIndex = null
    this.externalSubs = []
    this.probe = null
    this.plan = null
    this.mode = 'direct'
    this.clearSubtitleTrack()
    this.activeSubtitleId = null
    if (this.el) void this.prepareAndLoad()
  }

  private async prepareAndLoad(): Promise<void> {
    const seq = this.loadSeq
    const target = this.target
    if (!target || !this.el) return

    if (window.api.probeMedia) {
      const result = await window.api.probeMedia(target.itemId, target.relPath).catch(() => null)
      if (seq !== this.loadSeq) return
      if (result) {
        this.probe = result.probe
        this.plan = result.plan
      }
    }

    if (this.plan?.mode === 'transcode' && window.api.startTranscode) {
      await this.startTranscodeAt(target.startAt ?? 0, this.plan.videoCopy)
    } else {
      this.mode = 'direct'
      this.el.src = videoStreamUrl(target.itemId, target.relPath)
      this.startWatchdog()
    }
    if (seq !== this.loadSeq) return

    this.emit('tracksChanged')
    void this.loadExternalSubtitles(seq, target)
  }

  private async loadExternalSubtitles(seq: number, target: EngineLoadTarget): Promise<void> {
    if (!window.api.listSubtitleFiles) return
    const subs = await window.api.listSubtitleFiles(target.itemId, target.relPath).catch(() => [])
    if (seq !== this.loadSeq) return
    this.externalSubs = subs
    if (subs.length > 0) this.emit('tracksChanged')
  }

  // ------------------------------------------------------------- transcode --

  private async startTranscodeAt(seconds: number, videoCopy: boolean): Promise<void> {
    const seq = this.loadSeq
    const target = this.target
    const el = this.el
    if (!target || !el || !window.api.startTranscode) return

    this.stopActiveTranscode()
    const started = await window.api
      .startTranscode({
        itemId: target.itemId,
        relPath: target.relPath,
        startAt: seconds,
        audioStreamIndex: this.selectedAudioIndex ?? undefined,
        videoCopy
      })
      .catch(() => null)
    if (seq !== this.loadSeq || !started) return

    this.mode = 'transcode'
    this.transcode = { sessionId: started.sessionId, offset: seconds }
    el.src = transcodeSessionUrl(started.sessionId)
    void el.play().catch(() => {})
    this.startWatchdog()
    this.emit('durationchange')
  }

  private stopActiveTranscode(): void {
    if (this.transcode && window.api.stopTranscode) {
      void window.api.stopTranscode(this.transcode.sessionId)
    }
    this.transcode = null
  }

  /** onError nativo o watchdog: un reintento en transcode; si ya estaba ahí, al externo. */
  private handleCodecProblem(videoDecodes: boolean): void {
    if (
      this.mode === 'direct' &&
      !this.transcodeRetried &&
      window.api.startTranscode &&
      this.target
    ) {
      this.transcodeRetried = true
      const resumeAt = this.getState().currentTime
      // Si el video SÍ es de un códec que Chromium decodifica (el caso típico: falló
      // solo el audio), se copia en vez de recodificarlo: re-encodear un 4K en vivo
      // tarda demasiado en dar el primer frame.
      const videoStream = this.probe?.streams.find((s) => s.type === 'video')
      const videoCopy = videoStream ? isSupportedVideoCodec(videoStream.codec) : videoDecodes
      void this.startTranscodeAt(resumeAt, videoCopy)
      return
    }
    this.emitError({ reason: 'codec' })
  }

  // ------------------------------------------------------------- controles --

  play(): void {
    void this.el?.play().catch(() => {})
  }

  pause(): void {
    this.el?.pause()
  }

  seekTo(seconds: number): void {
    const el = this.el
    if (!el) return
    if (this.mode === 'transcode') {
      const duration = this.probe?.durationSec ?? 0
      const clamped = Math.max(0, duration ? Math.min(duration - 1, seconds) : seconds)
      void this.startTranscodeAt(clamped, this.plan?.videoCopy ?? false)
      return
    }
    if (!el.duration) return
    el.currentTime = Math.max(0, Math.min(el.duration, seconds))
  }

  seekBy(deltaSeconds: number): void {
    this.seekTo(this.getState().currentTime + deltaSeconds)
  }

  setVolume(volume01: number): void {
    this.volume = volume01
    if (this.el) this.el.volume = volume01
  }

  getState(): EngineState {
    const el = this.el
    if (!el) return { currentTime: 0, duration: 0, playing: false }
    if (this.mode === 'transcode') {
      return {
        currentTime: (this.transcode?.offset ?? 0) + el.currentTime,
        duration: this.probe?.durationSec ?? 0,
        playing: !el.paused
      }
    }
    return {
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      playing: !el.paused
    }
  }

  // ----------------------------------------------------------------- pistas --

  listTracks(): TrackSet {
    if (!this.probe) return { audio: [], subtitles: [] }

    const audioStreams = this.probe.streams.filter((s) => s.type === 'audio')
    const defaultAudio = audioStreams.find((s) => s.isDefault) ?? audioStreams[0]
    const selectedAudio = this.selectedAudioIndex ?? defaultAudio?.index

    const audio: MediaTrack[] = audioStreams.map((stream, position) => ({
      id: String(stream.index),
      kind: 'audio',
      label: audioLabel(stream, position),
      language: stream.language,
      codec: stream.codec,
      selected: stream.index === selectedAudio
    }))

    const subtitleStreams = this.probe.streams.filter((s) => s.type === 'subtitle')
    const subtitles: MediaTrack[] = subtitleStreams.map((stream, position) => ({
      id: String(stream.index),
      kind: 'subtitle',
      label: subtitleLabel(stream, position),
      language: stream.language,
      codec: stream.codec,
      unsupported: !TEXT_SUBTITLE_CODECS.has(stream.codec),
      selected: this.activeSubtitleId === String(stream.index)
    }))
    for (let i = 0; i < this.externalSubs.length; i++) {
      const sub = this.externalSubs[i]
      const id = `ext:${i}`
      subtitles.push({
        id,
        kind: 'subtitle',
        label: sub.language ? `${languageLabel(sub.language) || sub.language} (externo)` : sub.name,
        language: sub.language,
        selected: this.activeSubtitleId === id
      })
    }

    return { audio, subtitles }
  }

  setAudioTrack(id: string): void {
    const index = Number(id)
    if (!Number.isFinite(index)) return
    this.selectedAudioIndex = index

    if (this.mode === 'transcode') {
      // Cambiar de pista en transcode = relanzar la sesión donde íbamos.
      void this.startTranscodeAt(this.getState().currentTime, this.plan?.videoCopy ?? false)
      this.emit('tracksChanged')
      return
    }

    const el = this.el as VideoWithAudioTracks | null
    const audioStreams = (this.probe?.streams ?? []).filter((s) => s.type === 'audio')
    const position = audioStreams.findIndex((s) => s.index === index)
    const tracks = el?.audioTracks
    if (tracks && position >= 0 && tracks.length === audioStreams.length) {
      // Cambio en vivo vía blink AudioVideoTracks: mismo orden que el demuxer.
      for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === position
      this.emit('tracksChanged')
      return
    }

    // Sin audioTracks no hay forma de conmutar en directo: sesión con -map (el video
    // se copia, así que es rápido y sin pérdida).
    if (window.api.startTranscode) {
      void this.startTranscodeAt(this.getState().currentTime, true)
    }
    this.emit('tracksChanged')
  }

  setSubtitleTrack(id: string | null): void {
    this.clearSubtitleTrack()
    this.activeSubtitleId = id
    this.emit('tracksChanged')
    if (id === null || !this.target || !window.api.getSubtitleVtt) return

    // El VTT viaja por IPC (texto) y se monta como blob: — mismo origen, así el <track>
    // funciona sin volver CORS las peticiones del <video>.
    const seq = ++this.subtitleSeq
    const source = id.startsWith('ext:')
      ? { ext: this.externalSubs[Number(id.slice(4))]?.relPath ?? '' }
      : { stream: Number(id) }

    void window.api
      .getSubtitleVtt(this.target.itemId, this.target.relPath, source)
      .then((vtt) => {
        if (!vtt || seq !== this.subtitleSeq || !this.el || this.activeSubtitleId !== id) return
        const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.src = blobUrl
        track.default = true
        this.el.appendChild(track)
        track.track.mode = 'showing'
        this.trackEl = track
        this.trackBlobUrl = blobUrl
      })
      .catch(() => {})
  }

  private clearSubtitleTrack(): void {
    this.subtitleSeq += 1
    if (this.trackEl) {
      this.trackEl.remove()
      this.trackEl = null
    }
    if (this.trackBlobUrl) {
      URL.revokeObjectURL(this.trackBlobUrl)
      this.trackBlobUrl = null
    }
  }

  setViewMode(): void {}

  // ------------------------------------------------------------------ misc --

  on(event: EngineEvent, cb: () => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(cb)
    return () => set.delete(cb)
  }

  onError(cb: (error: EngineError) => void): () => void {
    this.errorListeners.add(cb)
    return () => this.errorListeners.delete(cb)
  }

  destroy(): void {
    this.loadSeq += 1
    this.stopWatchdog()
    this.stopActiveTranscode()
    this.clearSubtitleTrack()
    this.domCleanup?.()
    this.domCleanup = null
    if (this.el) {
      this.el.removeAttribute('src')
      this.el.load()
    }
    this.el = null
    this.listeners.clear()
    this.errorListeners.clear()
  }

  private emit(event: EngineEvent): void {
    this.listeners.get(event)?.forEach((cb) => cb())
  }

  private emitError(error: EngineError): void {
    this.errorListeners.forEach((cb) => cb(error))
  }

  // -------------------------------------------------------------- watchdog --
  // Pistas indecodificables que NO disparan onError: Chromium no falla el <video>,
  // solo omite en silencio lo que no sabe decodificar.
  //   - Video (p.ej. HEVC 4K 10-bit en tablets): con metadata cargada, un stream
  //     decodificable ya reporta dimensiones; si tras unos segundos sigue en 0x0,
  //     jamás habrá frames.
  //   - Audio (p.ej. AC3/DTS): el video se ve perfecto pero
  //     webkitAudioDecodedByteCount se queda clavado en 0 mientras avanza el tiempo.
  //     2 strikes de ~4s dan margen a que el decodificador arranque.
  // Corre por intervalo (no timeupdate) para cubrir también el caso atascado en pausa.

  private startWatchdog(): void {
    this.stopWatchdog()
    this.unsupportedFired = false
    this.silentAudioStrikes = 0
    this.lastAudioCheckTime = 0

    this.watchdogTimer = setInterval(() => {
      const video = this.el as VideoWithAudioByteCount | null
      if (!video || this.unsupportedFired) return

      if (video.readyState >= 1 && video.videoWidth === 0 && !video.error) {
        this.unsupportedFired = true
        this.stopWatchdog()
        this.handleCodecProblem(false)
        return
      }

      if (video.paused || video.videoWidth === 0) return
      const audioBytes = video.webkitAudioDecodedByteCount
      if (audioBytes === undefined) return // API no disponible en este WebView

      const advancing = video.currentTime > this.lastAudioCheckTime + 1
      this.lastAudioCheckTime = video.currentTime
      this.silentAudioStrikes = advancing && audioBytes === 0 ? this.silentAudioStrikes + 1 : 0

      if (this.silentAudioStrikes >= SILENT_AUDIO_STRIKES) {
        this.unsupportedFired = true
        this.stopWatchdog()
        this.handleCodecProblem(true) // el video sí decodifica: copiarlo en el reintento
      }
    }, UNSUPPORTED_CHECK_INTERVAL_MS)
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
  }
}
