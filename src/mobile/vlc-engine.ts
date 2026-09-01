import { videoStreamUrl } from '@shared/playback-url'
import type { MediaTrack, TrackSet } from '@shared/types'
import type {
  EngineCaps,
  EngineError,
  EngineEvent,
  EngineLoadTarget,
  EngineState,
  PlaybackEngine
} from '@/player/engine'
import { VlcPlayer, type VlcEvent, type VlcTrack } from './vlc-player-plugin'

/** Los eventos ESAdded/ESDeleted llegan en ráfaga al abrir: una sola recarga al final. */
const TRACKS_REFRESH_DEBOUNCE_MS = 300

/**
 * Motor nativo de Android: libVLC decodifica TODO (AC3/DTS, HEVC 10-bit, DivX,
 * MPEG-2) y pinta en un TextureView DEBAJO del WebView; la clase
 * `native-video-full` en <body> vuelve transparente la página para que el video se
 * vea con los controles de React encima. En mini la superficie se oculta y el audio
 * continúa (la mini-barra muestra la portada).
 */
export class VlcNativeEngine implements PlaybackEngine {
  readonly caps: EngineCaps = {
    pip: false,
    htmlFullscreen: false,
    rendersVideoInDom: false,
    nativeSubtitles: true
  }

  private state: EngineState = { currentTime: 0, duration: 0, playing: false }
  private tracks: TrackSet = { audio: [], subtitles: [] }
  private viewMode: 'full' | 'mini' = 'full'
  private listeners = new Map<EngineEvent, Set<() => void>>()
  private errorListeners = new Set<(error: EngineError) => void>()
  private pluginListener: Promise<{ remove: () => Promise<void> }>
  private tracksTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor() {
    this.pluginListener = VlcPlayer.addListener('vlcEvent', (event) => this.handleVlcEvent(event))
  }

  attachMedia(): void {
    // El video no vive en el DOM: no hay nada que conectar.
  }

  load(target: EngineLoadTarget): void {
    this.state = { currentTime: target.startAt ?? 0, duration: 0, playing: false }
    this.tracks = { audio: [], subtitles: [] }
    this.applyBodyClass()
    void VlcPlayer.open({
      url: videoStreamUrl(target.itemId, target.relPath),
      startAtMs: Math.round((target.startAt ?? 0) * 1000)
    })
    void this.loadExternalSubtitles(target)
  }

  /** Los .srt/.ass junto al video entran como "slaves": aparecen en el menú de pistas. */
  private async loadExternalSubtitles(target: EngineLoadTarget): Promise<void> {
    if (!window.api.listSubtitleFiles) return
    try {
      const candidates = await window.api.listSubtitleFiles(target.itemId, target.relPath)
      for (const candidate of candidates) {
        void VlcPlayer.addSubtitleSlave({ url: candidate.url, select: false })
      }
    } catch {
      // Sin subtítulos externos no se rompe nada.
    }
  }

  play(): void {
    void VlcPlayer.play()
  }

  pause(): void {
    void VlcPlayer.pause()
  }

  seekTo(seconds: number): void {
    const clamped = Math.max(0, this.state.duration ? Math.min(this.state.duration, seconds) : seconds)
    this.state.currentTime = clamped
    this.emit('timeupdate') // feedback inmediato en la barra; el evento nativo corrige.
    void VlcPlayer.seek({ timeMs: Math.round(clamped * 1000) })
  }

  seekBy(deltaSeconds: number): void {
    this.seekTo(this.state.currentTime + deltaSeconds)
  }

  setVolume(volume01: number): void {
    void VlcPlayer.setVolume({ volume: Math.round(Math.max(0, Math.min(1, volume01)) * 100) })
  }

  getState(): EngineState {
    return { ...this.state }
  }

  listTracks(): TrackSet {
    return this.tracks
  }

  setAudioTrack(id: string): void {
    void VlcPlayer.setAudioTrack({ id: Number(id) }).then(() => this.scheduleTracksRefresh())
  }

  setSubtitleTrack(id: string | null): void {
    void VlcPlayer.setSubtitleTrack({ id: id === null ? null : Number(id) }).then(() =>
      this.scheduleTracksRefresh()
    )
  }

  setViewMode(mode: 'full' | 'mini'): void {
    this.viewMode = mode
    this.applyBodyClass()
    void VlcPlayer.setVideoLayout({ mode: mode === 'full' ? 'fullscreen' : 'hidden' })
  }

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
    this.destroyed = true
    if (this.tracksTimer) clearTimeout(this.tracksTimer)
    document.body.classList.remove('native-video-full')
    void VlcPlayer.close()
    void this.pluginListener.then((handle) => handle.remove())
    this.listeners.clear()
    this.errorListeners.clear()
  }

  private applyBodyClass(): void {
    document.body.classList.toggle('native-video-full', this.viewMode === 'full')
  }

  private emit(event: EngineEvent): void {
    this.listeners.get(event)?.forEach((cb) => cb())
  }

  private handleVlcEvent(event: VlcEvent): void {
    if (this.destroyed) return
    const seconds = event.timeMs / 1000
    const duration = event.durationMs / 1000
    if (duration > 0 && duration !== this.state.duration) {
      this.state.duration = duration
      this.emit('durationchange')
    }
    switch (event.kind) {
      case 'time':
        this.state.currentTime = seconds
        this.emit('timeupdate')
        break
      case 'duration':
        break // ya cubierto arriba
      case 'playing':
        if (!this.state.playing) {
          this.state.playing = true
          this.emit('play')
        }
        break
      case 'paused':
        if (this.state.playing) {
          this.state.playing = false
          this.emit('pause')
        }
        break
      case 'buffering':
        break // la UI actual no muestra spinner; el estado playing no cambia.
      case 'ended':
        this.state.playing = false
        this.state.currentTime = this.state.duration
        this.emit('ended')
        break
      case 'error':
        this.state.playing = false
        // libVLC decodifica todo: si falla aquí es el stream/red, no el códec.
        this.errorListeners.forEach((cb) => cb({ reason: 'network' }))
        break
      case 'tracks':
        this.scheduleTracksRefresh()
        break
    }
  }

  private scheduleTracksRefresh(): void {
    if (this.tracksTimer) clearTimeout(this.tracksTimer)
    this.tracksTimer = setTimeout(() => {
      void this.refreshTracks()
    }, TRACKS_REFRESH_DEBOUNCE_MS)
  }

  private async refreshTracks(): Promise<void> {
    if (this.destroyed) return
    try {
      const result = await VlcPlayer.getTracks()
      const toMediaTracks = (
        list: VlcTrack[],
        kind: MediaTrack['kind'],
        selectedId: number
      ): MediaTrack[] =>
        list.map((track) => ({
          id: String(track.id),
          kind,
          label: track.name,
          selected: track.id === selectedId
        }))
      this.tracks = {
        audio: toMediaTracks(result.audio, 'audio', result.selectedAudio),
        subtitles: toMediaTracks(result.subtitles, 'subtitle', result.selectedSubtitle)
      }
      this.emit('tracksChanged')
    } catch {
      // Sin pistas el menú simplemente no se muestra.
    }
  }
}
