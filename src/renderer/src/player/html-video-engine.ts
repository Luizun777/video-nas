import { videoStreamUrl } from '@shared/playback-url'
import type { TrackSet } from '@shared/types'
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

/**
 * Motor sobre el <video> de Chromium. Incluye el watchdog de códecs indecodificables
 * que NO disparan onError: Chromium no falla el elemento, solo omite en silencio lo
 * que no sabe decodificar.
 *   - Video (p.ej. HEVC 4K 10-bit en tablets): con metadata cargada, un stream
 *     decodificable ya reporta dimensiones; si tras unos segundos sigue en 0x0,
 *     jamás habrá frames.
 *   - Audio (p.ej. AC3/DTS, muy común en rips "Dual-Lat" — Chromium en Android no
 *     trae esos decodificadores por licencias, a diferencia de macOS): el video se
 *     ve perfecto pero webkitAudioDecodedByteCount se queda clavado en 0 mientras
 *     avanza el tiempo. 2 strikes de ~4s dan margen a que el decodificador arranque
 *     sin dejar al usuario escuchando silencio de más.
 * Corre por intervalo (no timeupdate) para cubrir también el caso atascado en pausa.
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
    const emit = (event: EngineEvent) => (): void => this.emit(event)
    const onPlay = emit('play')
    const onPause = emit('pause')
    const onTimeUpdate = emit('timeupdate')
    const onDurationChange = emit('durationchange')
    const onEnded = emit('ended')
    const onLoadedMetadata = (): void => {
      const startAt = this.target?.startAt
      if (startAt && startAt > 0 && startAt < el.duration) el.currentTime = startAt
      this.emit('durationchange')
    }
    // Chromium no distingue el motivo; históricamente aquí siempre es códec (DivX/MPEG-2).
    const onError = (): void => this.emitError({ reason: 'codec' })

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

    if (this.target) this.applyLoad()
  }

  load(target: EngineLoadTarget): void {
    this.target = target
    if (this.el) this.applyLoad()
  }

  private applyLoad(): void {
    const el = this.el
    const target = this.target
    if (!el || !target) return
    el.src = videoStreamUrl(target.itemId, target.relPath)
    this.startWatchdog()
  }

  play(): void {
    void this.el?.play().catch(() => {})
  }

  pause(): void {
    this.el?.pause()
  }

  seekTo(seconds: number): void {
    const el = this.el
    if (!el || !el.duration) return
    el.currentTime = Math.max(0, Math.min(el.duration, seconds))
  }

  seekBy(deltaSeconds: number): void {
    const el = this.el
    if (!el) return
    this.seekTo(el.currentTime + deltaSeconds)
  }

  setVolume(volume01: number): void {
    this.volume = volume01
    if (this.el) this.el.volume = volume01
  }

  getState(): EngineState {
    const el = this.el
    if (!el) return { currentTime: 0, duration: 0, playing: false }
    return {
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      playing: !el.paused
    }
  }

  listTracks(): TrackSet {
    // Se llena en F14 (ffprobe + AudioVideoTracks + <track> WebVTT).
    return { audio: [], subtitles: [] }
  }

  setAudioTrack(): void {}
  setSubtitleTrack(): void {}
  setViewMode(): void {}

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
    this.stopWatchdog()
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
        this.emitError({ reason: 'codec' })
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
        this.emitError({ reason: 'codec' })
      }
    }, UNSUPPORTED_CHECK_INTERVAL_MS)
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
  }
}
